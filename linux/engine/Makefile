# Сборка Linux-движка обхода DPI (Yume Haze Zapret)
CC      ?= gcc
CFLAGS  ?= -O2 -Wall -Wextra
LDLIBS  ?= -lnetfilter_queue

all: hz-nfq

hz-nfq: hz-nfq.c
	$(CC) $(CFLAGS) -o $@ $< $(LDLIBS)

selftest: hz-nfq
	./hz-nfq --selftest

clean:
	rm -f hz-nfq

install-deps:
	@echo "Debian/Ubuntu: sudo apt install build-essential libnetfilter-queue-dev nftables"
	@echo "Arch/CachyOS:  sudo pacman -S base-devel libnetfilter_queue nftables"

.PHONY: all selftest clean install-deps
