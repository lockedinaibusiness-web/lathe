# Lathe Makefile.
# NOTE: on the primary dev machine (Windows 11) `make` is not installed; the
# canonical entry points are the pnpm scripts in package.json (see ADR-0005).
# This file is provided for POSIX developers and CI convenience.

.PHONY: dev build typecheck lint test schemas fixtures db-migrate clean

dev:
	pnpm dev

build:
	pnpm build

typecheck:
	pnpm typecheck

lint:
	pnpm lint

test:
	pnpm test

schemas:
	pnpm schemas:build

fixtures:
	pnpm fixtures:gen

db-migrate:
	pnpm db:migrate

clean:
	rm -rf .services .data dist coverage
