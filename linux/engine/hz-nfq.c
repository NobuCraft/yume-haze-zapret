/*
 * hz-nfq — Linux-движок обхода DPI для Yume Haze Zapret.
 *
 * Читает профиль, сгенерированный из стратегии Flowseal (general.bat и т.п.),
 * ловит пакеты через NFQUEUE (nftables/iptables ставит правила оболочка)
 * и применяет те же приёмы, что winws.exe под Windows:
 *
 *   multisplit   — режет первый сегмент данных на части со сдвигом seqovl
 *   fake         — подсовывает DPI поддельный пакет с малым TTL
 *   repeats      — сколько раз повторять фейк
 *   any-protocol — не только TLS/QUIC, любые данные
 *   cutoff       — через сколько пакетов потока перестать вмешиваться
 *   ip-id=zero   — обнуляет IP ID у изменённых пакетов
 *
 * Профиль (текстовый, его пишет src/linux.js):
 *   queue=200
 *   group
 *   filter_tcp=80,443
 *   hostlist=/path/list-general.txt
 *   desync=multisplit
 *   split_pos=1
 *   ...
 *   end
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/netfilter/nfnetlink_queue.h>
#include <linux/netfilter.h>
#include <libnetfilter_queue/libnetfilter_queue.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/ip6.h>
#include <netinet/tcp.h>
#include <netinet/udp.h>
#include <pwd.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#define MAX_GROUPS 16
#define MAX_PORTS 64
#define MAX_DOMAINS 4096
#define MAX_RANGES 200000
#define FLOW_BUCKETS 4096
#define FLOW_TTL 90
#define MAX_PATTERN 2048

/* ------------------------------------------------------------------ лог */
static int g_verbose = 0;
static FILE *g_log = NULL;

static void hzlog(const char *lvl, const char *fmt, ...) {
    if (!g_log) g_log = stderr;
    time_t now = time(NULL);
    struct tm tm;
    localtime_r(&now, &tm);
    char ts[32];
    strftime(ts, sizeof ts, "%H:%M:%S", &tm);
    fprintf(g_log, "%s [%s] ", ts, lvl);
    va_list ap;
    va_start(ap, fmt);
    vfprintf(g_log, fmt, ap);
    va_end(ap);
    fputc('\n', g_log);
    fflush(g_log);
}
#define LOGI(...) hzlog("INFO", __VA_ARGS__)
#define LOGW(...) hzlog("WARN", __VA_ARGS__)
#define LOGE(...) hzlog("ERR ", __VA_ARGS__)
#define LOGD(...) do { if (g_verbose) hzlog("DBG ", __VA_ARGS__); } while (0)

/* ------------------------------------------------------------------ утилиты */
static void *xcalloc(size_t n, size_t s) {
    void *p = calloc(n, s);
    if (!p) { LOGE("нет памяти (%zu x %zu)", n, s); exit(3); }
    return p;
}

static char *xstrdup(const char *s) {
    size_t n = strlen(s) + 1;
    char *d = xcalloc(n, 1);
    memcpy(d, s, n);
    return d;
}

static char *trim(char *s) {
    while (*s == ' ' || *s == '\t' || *s == '\r' || *s == '\n') s++;
    char *e = s + strlen(s);
    while (e > s && (e[-1] == ' ' || e[-1] == '\t' || e[-1] == '\r' || e[-1] == '\n')) *--e = 0;
    return s;
}

/* ------------------------------------------------------------------ порты */
typedef struct { int lo, hi; } port_range;
typedef struct { port_range r[MAX_PORTS]; int n; } port_set;

static int portset_has(const port_set *ps, int port) {
    for (int i = 0; i < ps->n; i++)
        if (port >= ps->r[i].lo && port <= ps->r[i].hi) return 1;
    return 0;
}

static void portset_parse(port_set *ps, const char *spec) {
    ps->n = 0;
    if (!spec || !*spec) return;
    char *copy = xstrdup(spec);
    char *save = NULL;
    for (char *tok = strtok_r(copy, ",", &save); tok && ps->n < MAX_PORTS; tok = strtok_r(NULL, ",", &save)) {
        tok = trim(tok);
        if (!*tok) continue;
        int lo = 0, hi = 0;
        if (sscanf(tok, "%d-%d", &lo, &hi) == 2) {
            if (lo > hi) { int t = lo; lo = hi; hi = t; }
        } else if (sscanf(tok, "%d", &lo) == 1) {
            hi = lo;
        } else {
            continue;
        }
        if (lo < 1 || hi > 65535) continue;
        ps->r[ps->n].lo = lo;
        ps->r[ps->n].hi = hi;
        ps->n++;
    }
    free(copy);
}

/* ------------------------------------------------------------------ домены */
typedef struct {
    char **items;      /* домены-суффиксы (youtube.com → *.youtube.com) */
    char **exact;      /* ^domain — только это имя */
    int n, nexact;
} domain_list;

static void domains_add(domain_list *dl, const char *raw) {
    char buf[512];
    snprintf(buf, sizeof buf, "%s", raw);
    char *s = trim(buf);
    if (!*s || *s == '#') return;
    if (strncmp(s, "include:", 8) == 0) return;   /* вложенные списки не поддерживаем */
    int exact = 0;
    if (*s == '^') { exact = 1; s = trim(s + 1); }
    /* отсекаем regex-хвосты вроде /.* и пути */
    char *slash = strchr(s, '/');
    if (slash) *slash = 0;
    size_t L = strlen(s);
    while (L && (s[L - 1] == '.' || s[L - 1] == ' ')) s[--L] = 0;
    if (!L) return;
    for (size_t i = 0; i < L; i++) if (s[i] >= 'A' && s[i] <= 'Z') s[i] = (char)(s[i] - 'A' + 'a');
    if (exact) {
        if (dl->nexact >= MAX_DOMAINS) return;
        dl->exact[dl->nexact++] = xstrdup(s);
    } else {
        if (dl->n >= MAX_DOMAINS) return;
        dl->items[dl->n++] = xstrdup(s);
    }
}

/* Поле может содержать несколько файлов через запятую — читаем все. */
static void domains_load(domain_list *dl, const char *files) {
    dl->items = xcalloc(MAX_DOMAINS, sizeof(char *));
    dl->exact = xcalloc(MAX_DOMAINS, sizeof(char *));
    dl->n = 0;
    dl->nexact = 0;
    if (!files || !*files) return;
    char *copy = xstrdup(files);
    char *save = NULL;
    for (char *tok = strtok_r(copy, ",", &save); tok; tok = strtok_r(NULL, ",", &save)) {
        char *file = trim(tok);
        if (!*file) continue;
        FILE *f = fopen(file, "r");
        if (!f) { LOGW("нет файла списка %s", file); continue; }
        char line[512];
        while (fgets(line, sizeof line, f)) domains_add(dl, line);
        fclose(f);
    }
    free(copy);
    if (dl->n || dl->nexact) LOGI("домены: %d суффиксов + %d точных", dl->n, dl->nexact);
}

/* domain == suffix (или сам домен). youtube.com матчит www.youtube.com */
static int domain_match(const domain_list *dl, const char *host) {
    if (!dl || (!dl->n && !dl->nexact) || !host || !*host) return 0;
    size_t hl = strlen(host);
    for (int i = 0; i < dl->nexact; i++)
        if (strcmp(dl->exact[i], host) == 0) return 1;
    for (int i = 0; i < dl->n; i++) {
        const char *d = dl->items[i];
        size_t dl2 = strlen(d);
        if (dl2 == 0 || dl2 > hl) continue;
        const char *tail = host + (hl - dl2);
        if (strcmp(tail, d) != 0) continue;
        if (dl2 == hl || host[hl - dl2 - 1] == '.') return 1;
    }
    return 0;
}

/* ------------------------------------------------------------------ CIDR */
typedef struct { uint32_t lo, hi; } v4range;
typedef struct { v4range *r; int n; } cidr_set;

static void cidr_free(cidr_set *cs) { free(cs->r); cs->r = NULL; cs->n = 0; }

static int cmp_range(const void *a, const void *b) {
    const v4range *x = a, *y = b;
    if (x->lo < y->lo) return -1;
    if (x->lo > y->lo) return 1;
    return 0;
}

static void cidr_load(cidr_set *cs, const char *files) {
    cs->r = xcalloc(MAX_RANGES, sizeof(v4range));
    cs->n = 0;
    if (!files || !*files) { free(cs->r); cs->r = NULL; return; }
    char *copy = xstrdup(files);
    char *save = NULL;
    int skipped_v6 = 0;
    char line[256];
    for (char *tok = strtok_r(copy, ",", &save); tok; tok = strtok_r(NULL, ",", &save)) {
    char *file = trim(tok);
    if (!*file) continue;
    FILE *f = fopen(file, "r");
    if (!f) { LOGW("нет файла ipset %s", file); continue; }
    while (fgets(line, sizeof line, f) && cs->n < MAX_RANGES) {
        char *s = trim(line);
        if (!*s || *s == '#' || *s == ';') continue;
        /* допускаем "1.2.3.0/24" и "1.2.3.4" */
        char ip[64];
        int bits = 32;
        if (sscanf(s, "%63[^/]/%d", ip, &bits) < 1) continue;
        struct in_addr a;
        if (inet_pton(AF_INET, trim(ip), &a) != 1) { skipped_v6++; continue; }
        if (bits < 0) bits = 0;
        if (bits > 32) bits = 32;
        uint32_t base = ntohl(a.s_addr);
        uint32_t mask = bits == 0 ? 0 : (bits == 32 ? 0xffffffffu : (0xffffffffu << (32 - bits)));
        uint32_t lo = base & mask;
        uint32_t hi = lo | (~mask);
        cs->r[cs->n].lo = lo;
        cs->r[cs->n].hi = hi;
        cs->n++;
    }
    fclose(f);
    }
    free(copy);
    if (cs->n) {
        qsort(cs->r, cs->n, sizeof(v4range), cmp_range);
        /* слияние пересекающихся диапазонов */
        int w = 1;
        for (int i = 1; i < cs->n; i++) {
            if (cs->r[i].lo <= cs->r[w - 1].hi + 1) {
                if (cs->r[i].hi > cs->r[w - 1].hi) cs->r[w - 1].hi = cs->r[i].hi;
            } else {
                cs->r[w++] = cs->r[i];
            }
        }
        cs->n = w;
    }
    LOGI("ipset: %d диапазонов (IPv6 пропущено: %d)", cs->n, skipped_v6);
}

static int cidr_has(const cidr_set *cs, uint32_t ip_host_order) {
    int lo = 0, hi = cs->n - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (ip_host_order < cs->r[mid].lo) hi = mid - 1;
        else if (ip_host_order > cs->r[mid].hi) lo = mid + 1;
        else return 1;
    }
    return 0;
}

/* ------------------------------------------------------------------ профиль */
typedef struct {
    char *name;
    port_set wf_tcp, wf_udp;      /* «внешние» порты из --wf-* (для правил nft) */
    port_set filter_tcp, filter_udp;
    char *filter_l7;              /* discord,stun — учтём по портам */
    char *hostlist;            /* могут быть списки через запятую */
    char *hostlist_exclude;
    char *hostlist_domains;
    char *ipset, *ipset_exclude;
    char desync[64];
    int split_pos;
    int split_seqovl;
    char *split_pattern;
    int repeats;
    char *fake_quic, *fake_discord, *fake_stun, *fake_tls, *fake_http, *fake_unknown_udp;
    int any_protocol;
    int cutoff;
    int ip_id_zero;
    int mirror;
    int fake_ttl;
    domain_list hl, hl_ex, hl_domains;
    cidr_set ips, ips_ex;
} group_cfg;

static group_cfg g_groups[MAX_GROUPS];
static int g_ngroups = 0;
static int g_queue = 200;
static char *g_logfile = NULL;

static void profile_free_replace(char **dst, const char *val) {
    free(*dst);
    *dst = xstrdup(val);
}

static void groups_unload(void) {
    for (int i = 0; i < g_ngroups; i++) {
        group_cfg *g = &g_groups[i];
        free(g->name);
        free(g->filter_l7); free(g->hostlist); free(g->hostlist_exclude); free(g->hostlist_domains);
        free(g->ipset); free(g->ipset_exclude);
        free(g->split_pattern); free(g->fake_quic); free(g->fake_discord); free(g->fake_stun);
        free(g->fake_tls); free(g->fake_http); free(g->fake_unknown_udp);
        for (int k = 0; k < g->hl.n; k++) free(g->hl.items[k]);
        for (int k = 0; k < g->hl.nexact; k++) free(g->hl.exact[k]);
        for (int k = 0; k < g->hl_ex.n; k++) free(g->hl_ex.items[k]);
        for (int k = 0; k < g->hl_ex.nexact; k++) free(g->hl_ex.exact[k]);
        for (int k = 0; k < g->hl_domains.n; k++) free(g->hl_domains.items[k]);
        free(g->hl.items); free(g->hl.exact);
        free(g->hl_ex.items); free(g->hl_ex.exact);
        free(g->hl_domains.items);
        cidr_free(&g->ips); cidr_free(&g->ips_ex);
    }
    g_ngroups = 0;
}

static int profile_load(const char *path) {
    FILE *f = fopen(path, "r");
    if (!f) { LOGE("профиль %s: %s", path, strerror(errno)); return -1; }
    groups_unload();
    group_cfg *cur = NULL;
    char line[1024];
    while (fgets(line, sizeof line, f)) {
        char *s = trim(line);
        if (!*s || *s == '#') continue;
        char *eq = strchr(s, '=');
        char *key = s;
        char *val = "";
        if (eq) { *eq = 0; key = trim(s); val = trim(eq + 1); }

        if (strcmp(key, "queue") == 0) { g_queue = atoi(val); continue; }
        if (strcmp(key, "log") == 0) { profile_free_replace(&g_logfile, val); continue; }
        if (strcmp(key, "verbose") == 0) { g_verbose = atoi(val); continue; }
        if (strcmp(key, "group") == 0) {
            if (g_ngroups >= MAX_GROUPS) { LOGW("слишком много групп, дальше игнорирую"); cur = NULL; continue; }
            cur = &g_groups[g_ngroups++];
            memset(cur, 0, sizeof *cur);
            cur->name = xstrdup("group");
            cur->split_pos = 1;
            cur->repeats = 1;
            cur->cutoff = 0;
            cur->fake_ttl = 4;
            continue;
        }
        if (strcmp(key, "end") == 0) { cur = NULL; continue; }
        if (!cur) continue;

        if (strcmp(key, "name") == 0) { profile_free_replace(&cur->name, val); }
        else if (strcmp(key, "wf_tcp") == 0) portset_parse(&cur->wf_tcp, val);
        else if (strcmp(key, "wf_udp") == 0) portset_parse(&cur->wf_udp, val);
        else if (strcmp(key, "filter_tcp") == 0) portset_parse(&cur->filter_tcp, val);
        else if (strcmp(key, "filter_udp") == 0) portset_parse(&cur->filter_udp, val);
        else if (strcmp(key, "filter_l7") == 0) profile_free_replace(&cur->filter_l7, val);
        else if (strcmp(key, "hostlist") == 0) profile_free_replace(&cur->hostlist, val);
        else if (strcmp(key, "hostlist_exclude") == 0) profile_free_replace(&cur->hostlist_exclude, val);
        else if (strcmp(key, "hostlist_domains") == 0) profile_free_replace(&cur->hostlist_domains, val);
        else if (strcmp(key, "ipset") == 0) profile_free_replace(&cur->ipset, val);
        else if (strcmp(key, "ipset_exclude") == 0) profile_free_replace(&cur->ipset_exclude, val);
        else if (strcmp(key, "desync") == 0) { snprintf(cur->desync, sizeof cur->desync, "%s", val); }
        else if (strcmp(key, "split_pos") == 0) cur->split_pos = atoi(val);
        else if (strcmp(key, "split_seqovl") == 0) cur->split_seqovl = atoi(val);
        else if (strcmp(key, "split_pattern") == 0) profile_free_replace(&cur->split_pattern, val);
        else if (strcmp(key, "repeats") == 0) cur->repeats = atoi(val);
        else if (strcmp(key, "fake_quic") == 0) profile_free_replace(&cur->fake_quic, val);
        else if (strcmp(key, "fake_discord") == 0) profile_free_replace(&cur->fake_discord, val);
        else if (strcmp(key, "fake_stun") == 0) profile_free_replace(&cur->fake_stun, val);
        else if (strcmp(key, "fake_tls") == 0) profile_free_replace(&cur->fake_tls, val);
        else if (strcmp(key, "fake_http") == 0) profile_free_replace(&cur->fake_http, val);
        else if (strcmp(key, "fake_unknown_udp") == 0) profile_free_replace(&cur->fake_unknown_udp, val);
        else if (strcmp(key, "any_protocol") == 0) cur->any_protocol = atoi(val);
        else if (strcmp(key, "cutoff") == 0) cur->cutoff = atoi(val);
        else if (strcmp(key, "ip_id_zero") == 0) cur->ip_id_zero = atoi(val);
        else if (strcmp(key, "fake_ttl") == 0) cur->fake_ttl = atoi(val);
        else if (strcmp(key, "mirror") == 0) cur->mirror = atoi(val);
    }
    fclose(f);

    for (int i = 0; i < g_ngroups; i++) {
        group_cfg *g = &g_groups[i];
        domains_load(&g->hl, g->hostlist);
        domains_load(&g->hl_ex, g->hostlist_exclude);
        /* --hostlist-domains=discord.media → список прямо в аргументе */
        if (g->hostlist_domains && *g->hostlist_domains) {
            char *copy = xstrdup(g->hostlist_domains);
            g->hl_domains.items = xcalloc(MAX_DOMAINS, sizeof(char *));
            g->hl_domains.exact = xcalloc(1, sizeof(char *));
            char *save = NULL;
            for (char *tok = strtok_r(copy, ",", &save); tok && g->hl_domains.n < MAX_DOMAINS; tok = strtok_r(NULL, ",", &save)) {
                char *d = trim(tok);
                if (!*d) continue;
                g->hl_domains.items[g->hl_domains.n++] = xstrdup(d);
            }
            free(copy);
        }
        cidr_load(&g->ips, g->ipset);
        cidr_load(&g->ips_ex, g->ipset_exclude);
        LOGI("группа %d «%s»: desync=%s tcp=%d udp=%d домены=%d ipset=%d",
             i, g->name, g->desync[0] ? g->desync : "—",
             g->filter_tcp.n, g->filter_udp.n, g->hl.n + g->hl_domains.n, g->ips.n);
    }
    if (!g_ngroups) { LOGE("в профиле нет ни одной группы фильтров"); return -1; }
    return 0;
}

/* ------------------------------------------------------------------ пакеты */
static uint16_t csum16(const void *data, size_t len) {
    const uint16_t *p = data;
    uint32_t sum = 0;
    while (len > 1) { sum += *p++; len -= 2; }
    if (len) sum += *(const uint8_t *)p;
    while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
    return (uint16_t)~sum;
}

typedef struct {
    uint8_t *buf;      /* весь IP-пакет */
    size_t len;
} packet_t;

static int inject_sock4 = -1;

static int inject_open(void) {
    inject_sock4 = socket(AF_INET, SOCK_RAW, IPPROTO_RAW);
    if (inject_sock4 < 0) {
        LOGE("raw socket: %s (нужен root)", strerror(errno));
        return -1;
    }
    int one = 1;
    setsockopt(inject_sock4, IPPROTO_IP, IP_HDRINCL, &one, sizeof one);
    return 0;
}

/*
 * Собирает IPv4-пакет из «шаблона» исходного пакета:
 *  - копия IP-заголовка и TCP/UDP-заголовка,
 *  - payload = payload или pattern,
 *  - произвольный seq для TCP,
 *  - произвольный TTL и IP ID.
 */
static size_t build_packet(const uint8_t *orig, int is_tcp,
                           const uint8_t *payload, size_t plen,
                           uint32_t seq_delta, int set_seq_abs, uint32_t seq_abs,
                           int ttl, int ip_id_zero, uint8_t *out, size_t outsz) {
    const struct iphdr *oip = (const struct iphdr *)orig;
    if (oip->version != 4) return 0;
    size_t ihl = oip->ihl * 4;
    size_t l4len = ntohs(oip->tot_len) - ihl;
    const uint8_t *ol4 = orig + ihl;

    size_t l4hdr = is_tcp ? ((const struct tcphdr *)ol4)->doff * 4 : sizeof(struct udphdr);
    if (l4len < l4hdr) return 0;

    size_t total = ihl + l4hdr + plen;
    if (total > outsz) return 0;
    memset(out, 0, total);
    memcpy(out, orig, ihl + l4hdr);

    struct iphdr *ip = (struct iphdr *)out;
    ip->tot_len = htons((uint16_t)total);
    ip->id = ip_id_zero ? 0 : htons((uint16_t)((rand() & 0x7fff) + 1));
    ip->ttl = (uint8_t)(ttl > 0 ? ttl : oip->ttl);
    ip->check = 0;
    ip->check = csum16(out, ihl);

    uint8_t *l4 = out + ihl;
    if (plen) memcpy(l4 + l4hdr, payload, plen);

    if (is_tcp) {
        struct tcphdr *tcp = (struct tcphdr *)l4;
        uint32_t seq = set_seq_abs ? seq_abs : ntohl(tcp->seq) + seq_delta;
        tcp->seq = htonl(seq);
        tcp->check = 0;
        /* псевдозаголовок */
        struct {
            uint32_t saddr, daddr;
            uint8_t zero, proto;
            uint16_t len;
        } ph;
        ph.saddr = ip->saddr; ph.daddr = ip->daddr; ph.zero = 0;
        ph.proto = IPPROTO_TCP;
        ph.len = htons((uint16_t)(l4hdr + plen));
        size_t blen = sizeof ph + l4hdr + plen;
        uint8_t *tmp = xcalloc(blen, 1);
        memcpy(tmp, &ph, sizeof ph);
        memcpy(tmp + sizeof ph, l4, l4hdr + plen);
        tcp->check = csum16(tmp, blen);
        free(tmp);
    } else {
        struct udphdr *udp = (struct udphdr *)l4;
        udp->len = htons((uint16_t)(l4hdr + plen));
        udp->check = 0;
        struct {
            uint32_t saddr, daddr;
            uint8_t zero, proto;
            uint16_t len;
        } ph;
        ph.saddr = ip->saddr; ph.daddr = ip->daddr; ph.zero = 0;
        ph.proto = IPPROTO_UDP;
        ph.len = htons((uint16_t)(l4hdr + plen));
        size_t blen = sizeof ph + l4hdr + plen;
        uint8_t *tmp = xcalloc(blen, 1);
        memcpy(tmp, &ph, sizeof ph);
        memcpy(tmp + sizeof ph, l4, l4hdr + plen);
        uint16_t c = csum16(tmp, blen);
        udp->check = c == 0 ? 0xffff : c;
        free(tmp);
    }
    return total;
}

static int send_raw(const uint8_t *pkt, size_t len) {
    if (inject_sock4 < 0) return -1;
    struct sockaddr_in dst;
    memset(&dst, 0, sizeof dst);
    dst.sin_family = AF_INET;
    const struct iphdr *ip = (const struct iphdr *)pkt;
    dst.sin_addr.s_addr = ip->daddr;
    ssize_t n = sendto(inject_sock4, pkt, len, 0, (struct sockaddr *)&dst, sizeof dst);
    if (n < 0) { LOGD("sendto: %s", strerror(errno)); return -1; }
    return 0;
}

/* ------------------------------------------------------------------ SNI */
/* Возвращает длину имени или 0. Поддержка TLS 1.0-1.3 ClientHello. */
static size_t tls_sni(const uint8_t *data, size_t len, char *out, size_t outsz) {
    if (len < 5 + 4) return 0;
    if (data[0] != 0x16 || data[1] != 0x03) return 0;   /* handshake, TLS */
    size_t hl = data[3] * 256 + data[4];
    if (hl + 5 > len) hl = len - 5;
    size_t p = 5;
    if (p + 4 > len) return 0;
    if (data[p] != 0x01) return 0;                      /* client hello */
    p += 4;
    p += 2 + 32;                                        /* version + random */
    if (p + 1 > len) return 0;
    p += 1 + data[p];                                   /* session id */
    if (p + 2 > len) return 0;
    size_t cs = data[p] * 256 + data[p + 1];
    p += 2 + cs;
    if (p + 1 > len) return 0;
    p += 1 + data[p];                                   /* compression */
    if (p + 2 > len) return 0;
    size_t ext_total = data[p] * 256 + data[p + 1];
    p += 2;
    size_t end = p + ext_total;
    if (end > len) end = len;
    while (p + 4 <= end) {
        int type = data[p] * 256 + data[p + 1];
        size_t elen = data[p + 2] * 256 + data[p + 3];
        p += 4;
        if (p + elen > end) break;
        if (type == 0x0000 && elen > 5) {               /* server_name */
            const uint8_t *e = data + p;
            int ntype = e[2];
            size_t nlen = e[3] * 256 + e[4];
            if (ntype == 0 && nlen > 0 && 5 + nlen <= elen) {
                if (nlen >= outsz) nlen = outsz - 1;
                memcpy(out, e + 5, nlen);
                out[nlen] = 0;
                return nlen;
            }
        }
        p += elen;
    }
    return 0;
}

/* ------------------------------------------------------------------ потоки */
typedef struct flow {
    uint32_t saddr, daddr;
    uint16_t sport, dport;
    uint8_t proto;
    int packets;         /* сколько пакетов с данными уже прошло */
    int desynced;
    time_t seen;
    struct flow *next;
} flow_t;

static flow_t *g_flows[FLOW_BUCKETS];

static unsigned flow_hash(uint32_t sa, uint32_t da, uint16_t sp, uint16_t dp, uint8_t pr) {
    unsigned h = 2166136261u;
    const uint32_t vals[2] = { sa, da };
    for (int i = 0; i < 2; i++) { h ^= vals[i]; h *= 16777619u; }
    h ^= sp; h *= 16777619u;
    h ^= dp; h *= 16777619u;
    h ^= pr; h *= 16777619u;
    return h % FLOW_BUCKETS;
}

static flow_t *flow_get(uint32_t sa, uint32_t da, uint16_t sp, uint16_t dp, uint8_t pr, int create) {
    unsigned b = flow_hash(sa, da, sp, dp, pr);
    time_t now = time(NULL);
    for (flow_t *f = g_flows[b]; f; f = f->next) {
        if (f->saddr == sa && f->daddr == da && f->sport == sp && f->dport == dp && f->proto == pr) {
            f->seen = now;
            return f;
        }
    }
    if (!create) return NULL;
    flow_t *f = xcalloc(1, sizeof *f);
    f->saddr = sa; f->daddr = da; f->sport = sp; f->dport = dp; f->proto = pr;
    f->seen = now;
    f->next = g_flows[b];
    g_flows[b] = f;
    return f;
}

static void flows_gc(void) {
    time_t now = time(NULL);
    for (int b = 0; b < FLOW_BUCKETS; b++) {
        flow_t **pp = &g_flows[b];
        while (*pp) {
            flow_t *f = *pp;
            if (now - f->seen > FLOW_TTL) {
                *pp = f->next;
                free(f);
            } else {
                pp = &f->next;
            }
        }
    }
}

/* ------------------------------------------------------------------ выбор группы */
static group_cfg *pick_group(int is_tcp, uint16_t dport, uint32_t daddr_host,
                            const char *sni, int has_ipset_data) {
    for (int i = 0; i < g_ngroups; i++) {
        group_cfg *g = &g_groups[i];
        const port_set *ps = is_tcp ? &g->filter_tcp : &g->filter_udp;
        if (ps->n && !portset_has(ps, dport)) continue;
        if (!ps->n) continue;

        int has_ip = g->ips.n > 0;
        if (has_ip && g->ips_ex.n && cidr_has(&g->ips_ex, daddr_host)) continue;

        int need_domain = g->hl.n > 0 || g->hl_domains.n > 0;
        if (need_domain) {
            if (!sni || !*sni) continue;
            if (domain_match(&g->hl, sni) || domain_match(&g->hl_domains, sni)) {
                if (g->hl_ex.n && domain_match(&g->hl_ex, sni)) continue;
                return g;
            }
            if (!has_ip) continue;
        }
        if (has_ip) {
            if (!has_ipset_data) continue;
            if (!cidr_has(&g->ips, daddr_host)) continue;
            return g;
        }
        if (need_domain) continue;
        /* Без списков доменов и без ipset группа матчит ВЕСЬ трафик на портах.
           Для UDP это нормально (Discord/QUIC по портам), для TCP — слишком грубо:
           резать весь 443 без списков ломает обычные сайты. Пропускаем. */
        if (is_tcp) continue;
        return g;
    }
    return NULL;
}

/* ------------------------------------------------------------------ desync */
static uint8_t g_fake_buf[MAX_PATTERN];

static size_t load_pattern(const char *file, uint8_t *out, size_t outsz) {
    if (!file || !*file) return 0;
    FILE *f = fopen(file, "rb");
    if (!f) return 0;
    size_t n = fread(out, 1, outsz, f);
    fclose(f);
    return n;
}

/*
 * Применяет приём к одному пакету.
 * Возвращает: 1 — пакет нужно пропустить (NF_ACCEPT), 0 — отбросить (NF_DROP).
 * Все дополнительные пакеты отправляются прямо здесь через raw socket.
 */
static int apply_desync(group_cfg *g, const uint8_t *pkt, size_t len __attribute__((unused)), int is_tcp,
                        const uint8_t *payload, size_t plen) {
    uint8_t out[65535];

    if (!g->desync[0]) return 1;

    if (strstr(g->desync, "multisplit") || strstr(g->desync, "split2") || strstr(g->desync, "disorder")) {
        if (!is_tcp || !plen) return 1;
        size_t pos = (size_t)(g->split_pos > 0 ? g->split_pos : 1);
        if (pos >= plen) pos = plen ? plen - 1 : 0;
        if (!pos) return 1;

        /* первая часть: начальный кусок */
        size_t n1 = build_packet(pkt, 1, payload, pos, 0, 0, 0,
                                 ((const struct iphdr *)pkt)->ttl, g->ip_id_zero, out, sizeof out);
        if (n1) send_raw(out, n1);

        /* вторая часть: остаток; если задан seqovl — со сдвигом назад,
           тогда кусок SNI попадает в оба сегмента (это и обманывает DPI) */
        int ovl = g->split_seqovl > 0 ? g->split_seqovl : 0;
        if (ovl > (int)plen) ovl = (int)plen - 1;
        size_t from = pos;
        uint32_t seq_abs = ntohl(((const struct tcphdr *)(pkt + (((const struct iphdr *)pkt)->ihl * 4)))->seq) + (uint32_t)pos;
        if (ovl > 0 && (size_t)ovl > pos) {
            from = 0;                      /* перекрываем с самого начала */
            seq_abs -= (uint32_t)pos;
        } else if (ovl > 0) {
            from = pos - (size_t)ovl;
            seq_abs -= (uint32_t)ovl;
        }
        size_t n2 = build_packet(pkt, 1, payload + from, plen - from, 0, 1, seq_abs,
                                 ((const struct iphdr *)pkt)->ttl, g->ip_id_zero, out, sizeof out);
        if (n2) send_raw(out, n2);
        LOGD("multisplit: pos=%zu ovl=%d пакетов данных=%zu", pos, ovl, plen);
        return 0;                          /* оригинал больше не нужен */
    }

    if (strstr(g->desync, "fake")) {
        const uint8_t *pattern = NULL;
        size_t pat_len = 0;
        const char *file = NULL;
        if (is_tcp) {
            if (g->fake_tls) file = g->fake_tls;
            else if (g->fake_http) file = g->fake_http;
        } else {
            if (g->fake_quic) file = g->fake_quic;
            else if (g->fake_unknown_udp) file = g->fake_unknown_udp;
            else if (g->fake_discord) file = g->fake_discord;
            else if (g->fake_stun) file = g->fake_stun;
        }
        if (file) pat_len = load_pattern(file, g_fake_buf, sizeof g_fake_buf);
        pattern = pat_len ? g_fake_buf : payload;
        if (!pat_len) pat_len = plen > 64 ? 64 : plen;
        if (!pat_len) return 1;

        int reps = g->repeats > 0 ? g->repeats : 1;
        if (reps > 16) reps = 16;
        for (int i = 0; i < reps; i++) {
            size_t n = build_packet(pkt, is_tcp, pattern, pat_len, 0, 0, 0,
                                    g->fake_ttl, 0, out, sizeof out);
            if (n) send_raw(out, n);
        }
        LOGD("fake: %s, повторов %d, ttl %d", file ? file : "payload", reps, g->fake_ttl);
        return 1;                          /* настоящий пакет идёт как обычно */
    }

    return 1;
}

/* ------------------------------------------------------------------ NFQUEUE */
static struct nfq_handle *g_h = NULL;
static struct nfq_q_handle *g_qh = NULL;
static int g_fd = -1;

static int handle_packet(struct nfq_q_handle *qh, struct nfq_data *nfa, uint32_t id) {
    struct nfqnl_msg_packet_hdr *ph = nfq_get_msg_packet_hdr(nfa);
    int is_tcp = ph && ph->hw_protocol == 0 && 0;   /* заполним ниже */
    (void)is_tcp;
    unsigned char *raw = NULL;
    int len = nfq_get_payload(nfa, &raw);
    if (len <= 0 || !raw) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);

    const struct iphdr *ip = (const struct iphdr *)raw;
    if (ip->version != 4) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);

    size_t ihl = ip->ihl * 4;
    if ((size_t)len < ihl) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);

    uint8_t proto = ip->protocol;
    if (proto != IPPROTO_TCP && proto != IPPROTO_UDP)
        return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);

    const uint8_t *l4 = raw + ihl;
    uint16_t sport = 0, dport = 0;
    size_t l4hdr = 0;
    int tcp = proto == IPPROTO_TCP;

    if (tcp) {
        const struct tcphdr *th = (const struct tcphdr *)l4;
        l4hdr = th->doff * 4;
        if (l4hdr < 20 || (size_t)len < ihl + l4hdr) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);
        sport = ntohs(th->source);
        dport = ntohs(th->dest);
        if (th->rst || th->fin) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);
        if (!th->syn && !(th->psh || th->ack)) { /* управляющие без данных — не трогаем */ }
        if (th->syn) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);
    } else {
        const struct udphdr *uh = (const struct udphdr *)l4;
        l4hdr = sizeof(struct udphdr);
        if ((size_t)len < ihl + l4hdr) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);
        sport = ntohs(uh->source);
        dport = ntohs(uh->dest);
    }

    size_t plen = (size_t)len - ihl - l4hdr;
    if (!plen) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);

    const uint8_t *payload = l4 + l4hdr;
    uint32_t saddr = ntohl(ip->saddr), daddr = ntohl(ip->daddr);

    flow_t *fl = flow_get(saddr, daddr, sport, dport, proto, 1);
    if (!fl) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);
    fl->packets++;

    /* SNI из TLS ClientHello */
    char sni[256];
    size_t sni_len = tcp ? tls_sni(payload, plen, sni, sizeof sni) : 0;
    if (!sni_len) sni[0] = 0;

    int has_ipset_data = 1;   /* ipset уже загружен в группу; проверяется в pick_group */
    group_cfg *g = pick_group(tcp, dport, daddr, sni_len ? sni : NULL, has_ipset_data);
    if (!g) return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);

    /* any-protocol: если протокол не TLS/QUIC и флаг не включён — не вмешиваемся */
    if (!g->any_protocol) {
        int looks_tls = sni_len > 0;
        int looks_quic = (!tcp) && plen > 5 && (payload[1] == 0x00 || payload[1] == 0x01 || payload[1] == 0x02);
        int looks_http = plen > 2 && (memcmp(payload, "GET ", 4) == 0 || memcmp(payload, "POST", 4) == 0);
        int looks_stun = (!tcp) && plen > 4 && payload[0] == 0x00 && payload[1] == 0x01;
        if (!looks_tls && !looks_quic && !looks_http && !looks_stun) {
            if (!(tcp && plen > 0 && (dport == 443 || dport == 80)))  /* остальное только на 80/443 */
                return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);
        }
    }

    if (g->cutoff > 0 && fl->packets > g->cutoff)
        return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);

    /* в UDP десинк применяем только к первым пакетам потока */
    if (!tcp && fl->desynced && g->cutoff == 0)
        return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);

    int verdict = apply_desync(g, raw, (size_t)len, tcp, payload, plen);
    fl->desynced = 1;
    LOGD("%s :%u → %s:%u «%s» sni=%s verdict=%s",
         tcp ? "TCP" : "UDP", sport, tcp ? "tcp" : "udp", dport, g->name,
         sni_len ? sni : "—", verdict ? "ACCEPT" : "DROP");
    return nfq_set_verdict(qh, id, verdict ? NF_ACCEPT : NF_DROP, 0, NULL);
}

static int cb(struct nfq_q_handle *qh, struct nfgenmsg *nmsg, struct nfq_data *nfa, void *data) {
    (void)nmsg; (void)data;
    struct nfqnl_msg_packet_hdr *ph = nfq_get_msg_packet_hdr(nfa);
    uint32_t id = ph ? ntohl(ph->packet_id) : 0;
    return handle_packet(qh, nfa, id);
}

/* ------------------------------------------------------------------ сигналы */
static volatile sig_atomic_t g_stop = 0;
static void on_signal(int sig) { (void)sig; g_stop = 1; }

/* ------------------------------------------------------------------ selftest */
/* Собирает корректный TLS ClientHello с заданным SNI (для selftest). */
static size_t build_client_hello(const char *host, uint8_t *out, size_t outsz) {
    uint8_t body[512];
    size_t p = 0;
    body[p++] = 0x01;                       /* client_hello */
    size_t len_at = p;
    body[p++] = 0; body[p++] = 0; body[p++] = 0;
    body[p++] = 0x03; body[p++] = 0x03;     /* version */
    for (int i = 0; i < 32; i++) body[p++] = (uint8_t)(i + 1);   /* random */
    body[p++] = 32;                          /* session id len */
    for (int i = 0; i < 32; i++) body[p++] = (uint8_t)(i + 7);
    body[p++] = 0; body[p++] = 2; body[p++] = 0x13; body[p++] = 0x01;  /* ciphers */
    body[p++] = 1; body[p++] = 0;            /* compression: null */
    size_t ext_len_at = p;
    body[p++] = 0; body[p++] = 0;
    size_t ext_start = p;
    size_t hl = strlen(host);
    body[p++] = 0; body[p++] = 0;            /* server_name */
    size_t sn_len_at = p;
    body[p++] = 0; body[p++] = 0;
    size_t sn_start = p;
    body[p++] = 0; body[p++] = 0;            /* list len */
    body[p++] = 0;                           /* host name type */
    body[p++] = (uint8_t)(hl >> 8); body[p++] = (uint8_t)hl;
    memcpy(body + p, host, hl); p += hl;
    body[sn_start] = (uint8_t)((p - sn_start - 2) >> 8);
    body[sn_start + 1] = (uint8_t)(p - sn_start - 2);
    body[sn_len_at] = (uint8_t)((p - sn_start) >> 8);
    body[sn_len_at + 1] = (uint8_t)(p - sn_start);
    body[ext_len_at] = (uint8_t)((p - ext_start) >> 8);
    body[ext_len_at + 1] = (uint8_t)(p - ext_start);
    size_t body_len = p - len_at - 3;
    body[len_at] = (uint8_t)(body_len >> 16);
    body[len_at + 1] = (uint8_t)(body_len >> 8);
    body[len_at + 2] = (uint8_t)body_len;
    /* внешний слой: handshake + record */
    size_t q = 0;
    out[q++] = 0x16; out[q++] = 0x03; out[q++] = 0x01;
    out[q++] = (uint8_t)(p >> 8); out[q++] = (uint8_t)p;
    memcpy(out + q, body, p); q += p;
    (void)outsz;
    return q;
}

static int selftest(void) {
    static uint8_t hello[600];
    size_t hello_len = build_client_hello("www.youtube.com", hello, sizeof hello);

    char sni[256];
    size_t n = tls_sni(hello, hello_len, sni, sizeof sni);
    if (!n || strcmp(sni, "www.youtube.com") != 0) {
        fprintf(stderr, "selftest: SNI не разобран (%zu, «%s»)\n", n, sni);
        return 1;
    }
    printf("selftest: SNI = %s\n", sni);

    /* списки доменов */
    domain_list dl;
    dl.items = xcalloc(4, sizeof(char *));
    dl.exact = xcalloc(4, sizeof(char *));
    dl.n = 0;
    dl.nexact = 0;
    dl.items[dl.n++] = xstrdup("youtube.com");
    dl.items[dl.n++] = xstrdup("googlevideo.com");
    dl.exact[dl.nexact++] = xstrdup("dns.google");
    if (!domain_match(&dl, sni)) { fprintf(stderr, "selftest: домен не совпал\n"); return 1; }
    if (domain_match(&dl, "notyoutube.com")) { fprintf(stderr, "selftest: ложное совпадение домена\n"); return 1; }
    if (!domain_match(&dl, "dns.google")) { fprintf(stderr, "selftest: точный домен ^\n"); return 1; }
    if (domain_match(&dl, "x.dns.google")) { fprintf(stderr, "selftest: ^ должен быть точным\n"); return 1; }
    printf("selftest: домены ok\n");

    /* порты */
    port_set ps;
    portset_parse(&ps, "80,443,2053,2083,2087,2096,8443,1024-65535");
    if (!portset_has(&ps, 443) || !portset_has(&ps, 5000) || portset_has(&ps, 53)) {
        fprintf(stderr, "selftest: порты\n");
        return 1;
    }
    printf("selftest: порты ok (%d диапазонов)\n", ps.n);

    /* ipset */
    cidr_set cs;
    cs.r = xcalloc(8, sizeof(v4range));
    cs.n = 0;
    struct in_addr a;
    inet_pton(AF_INET, "10.0.0.0", &a);
    cs.r[cs.n].lo = ntohl(a.s_addr);
    cs.r[cs.n].hi = ntohl(a.s_addr) + 255;
    cs.n = 1;
    inet_pton(AF_INET, "10.0.0.5", &a);
    if (!cidr_has(&cs, ntohl(a.s_addr))) { fprintf(stderr, "selftest: ipset\n"); return 1; }
    inet_pton(AF_INET, "10.0.2.5", &a);
    if (cidr_has(&cs, ntohl(a.s_addr))) { fprintf(stderr, "selftest: ipset ложное\n"); return 1; }
    free(cs.r);
    printf("selftest: ipset ok\n");

    /* сборка пакета: заголовки и контрольные суммы */
    uint8_t fake_ip[40 + 20 + 600];
    memset(fake_ip, 0, sizeof fake_ip);
    struct iphdr *ip = (struct iphdr *)fake_ip;
    ip->version = 4; ip->ihl = 5;
    ip->tot_len = htons(40 + hello_len);
    ip->protocol = IPPROTO_TCP;
    ip->ttl = 64;
    inet_pton(AF_INET, "192.168.1.10", &ip->saddr);
    inet_pton(AF_INET, "142.250.74.46", &ip->daddr);
    struct tcphdr *th = (struct tcphdr *)(fake_ip + 20);
    th->source = htons(54321); th->dest = htons(443);
    th->doff = 5; th->ack = 1; th->psh = 1;
    th->seq = htonl(1000);
    memcpy(fake_ip + 40, hello, hello_len);

    uint8_t out[2048];
    size_t outn = build_packet(fake_ip, 1, hello, 10, 0, 1, 1001, 4, 1, out, sizeof out);
    if (outn != 20 + 20 + 10) { fprintf(stderr, "selftest: длина пакета %zu\n", outn); return 1; }
    struct iphdr *oip = (struct iphdr *)out;
    if (oip->ttl != 4 || oip->id != 0) { fprintf(stderr, "selftest: ttl/id\n"); return 1; }
    if (oip->check == 0) { fprintf(stderr, "selftest: контрольная сумма IP\n"); return 1; }
    struct tcphdr *otcp = (struct tcphdr *)(out + 20);
    if (ntohl(otcp->seq) != 1001) { fprintf(stderr, "selftest: seq\n"); return 1; }
    if (otcp->check == 0) { fprintf(stderr, "selftest: контрольная сумма TCP\n"); return 1; }
    printf("selftest: сборка пакетов ok (%zu байт)\n", outn);
    printf("selftest: ВСЁ ОК\n");
    return 0;
}

/* ------------------------------------------------------------------ main */
static void usage(void) {
    printf("hz-nfq — Linux-движок обхода DPI (Yume Haze Zapret)\n"
           "  hz-nfq --profile <файл> [--queue N] [--log <файл>] [--verbose]\n"
           "  hz-nfq --selftest\n"
           "  hz-nfq --check-profile <файл>   проверить профиль и выйти\n");
}

int main(int argc, char **argv) {
    const char *profile = NULL;
    const char *logfile = NULL;
    int check_only = 0;

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--selftest")) return selftest();
        else if (!strcmp(argv[i], "--profile") && i + 1 < argc) profile = argv[++i];
        else if (!strcmp(argv[i], "--check-profile") && i + 1 < argc) { profile = argv[++i]; check_only = 1; }
        else if (!strcmp(argv[i], "--queue") && i + 1 < argc) g_queue = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--log") && i + 1 < argc) logfile = argv[++i];
        else if (!strcmp(argv[i], "--verbose")) g_verbose = 1;
        else if (!strcmp(argv[i], "-h") || !strcmp(argv[i], "--help")) { usage(); return 0; }
        else { fprintf(stderr, "неизвестный аргумент: %s\n", argv[i]); usage(); return 2; }
    }
    if (!profile) { usage(); return 2; }
    if (logfile) {
        g_log = fopen(logfile, "a");
        if (!g_log) { fprintf(stderr, "лог %s: %s\n", logfile, strerror(errno)); g_log = stderr; }
    }

    if (profile_load(profile) != 0) return 1;
    if (check_only) { printf("профиль ok: групп %d, очередь %d\n", g_ngroups, g_queue); return 0; }

    srand((unsigned)time(NULL) ^ (unsigned)getpid());

    if (inject_open() != 0) return 1;

    g_h = nfq_open();
    if (!g_h) { LOGE("nfq_open: %s", strerror(errno)); return 1; }
    if (nfq_unbind_pf(g_h, AF_INET) < 0) LOGE("nfq_unbind_pf: %s", strerror(errno));
    if (nfq_bind_pf(g_h, AF_INET) < 0) { LOGE("nfq_bind_pf: %s (нужен root)", strerror(errno)); return 1; }
    g_qh = nfq_create_queue(g_h, (uint16_t)g_queue, &cb, NULL);
    if (!g_qh) { LOGE("nfq_create_queue(%d): %s", g_queue, strerror(errno)); return 1; }
    if (nfq_set_mode(g_qh, NFQNL_COPY_PACKET, 0xffff) < 0) { LOGE("nfq_set_mode"); return 1; }

    g_fd = nfq_fd(g_h);
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_signal;
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    LOGI("движок запущен: очередь %d, групп %d, стратегий в профиле: %d", g_queue, g_ngroups, 1);

    static uint8_t buf[65536];
    time_t last_gc = time(NULL);
    while (!g_stop) {
        struct timeval tv = { .tv_sec = 1, .tv_usec = 0 };
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(g_fd, &fds);
        int r = select(g_fd + 1, &fds, NULL, NULL, &tv);
        if (r < 0) {
            if (errno == EINTR) continue;
            LOGE("select: %s", strerror(errno));
            break;
        }
        if (r == 0) {
            if (time(NULL) - last_gc > 10) { flows_gc(); last_gc = time(NULL); }
            continue;
        }
        int len = (int)recv(g_fd, buf, sizeof buf, 0);
        if (len < 0) {
            if (errno == ENOBUFS || errno == EINTR) { LOGW("recv: %s", strerror(errno)); continue; }
            LOGE("recv: %s", strerror(errno));
            break;
        }
        nfq_handle_packet(g_h, (char *)buf, len);
    }

    LOGI("движок останавливается");
    nfq_destroy_queue(g_qh);
    nfq_close(g_h);
    if (inject_sock4 >= 0) close(inject_sock4);
    return 0;
}
