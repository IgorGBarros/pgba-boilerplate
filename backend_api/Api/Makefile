# backend_api/Api/Makefile
.PHONY: run migrate makemigrations shell test lint format sync-obsidian configure-ai

run:
	python manage.py runserver

migrate:
	python manage.py migrate

makemigrations:
	python manage.py makemigrations

shell:
	python manage.py shell

test:
	pytest

lint:
	flake8 .
	black --check .
	isort --check-only .

format:
	black .
	isort .

sync-obsidian:
	python manage.py sync_obsidian --tenant $(TENANT) --path $(PATH)

configure-ai:
	python manage.py configure_ai_provider --provider $(PROVIDER) --api-key $(KEY) --model $(MODEL)
