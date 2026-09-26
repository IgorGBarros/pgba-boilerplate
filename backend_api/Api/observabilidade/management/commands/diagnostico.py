# backend_api/Api/observabilidade/management/commands/diagnostico.py
"""
Uso (funciona com o site fora do ar e com o banco fora):
    python manage.py diagnostico
    docker compose exec backend python manage.py diagnostico
    docker compose run --rm backend python manage.py diagnostico   # backend parado

Mostra banco, Redis, workers, agendador, disco e configuração, com a causa
provável e o que fazer em cada falha.
"""
from django.core.management.base import BaseCommand

from observabilidade import plataforma

ICONE = {"ok": "OK   ", "alerta": "ATENÇÃO", "falha": "FALHA", "desconhecido": "?    "}


class Command(BaseCommand):
    help = "Diagnóstico da plataforma: o que está fora do ar, por quê e o que fazer."

    def handle(self, *args, **opts):
        resultados = plataforma.todas()
        pior = "ok"
        for r in resultados:
            estilo = {"falha": self.style.ERROR, "alerta": self.style.WARNING}.get(
                r.status, self.style.SUCCESS
            )
            self.stdout.write(estilo(f"[{ICONE.get(r.status, r.status)}] {r.nome}: {r.detalhe}"))
            if r.causa:
                self.stdout.write(f"        por quê: {r.causa}")
            if r.acao:
                self.stdout.write(f"        o que fazer: {r.acao}")
            if r.status == "falha":
                pior = "falha"
            elif r.status == "alerta" and pior == "ok":
                pior = "alerta"
        self.stdout.write("")
        if pior == "ok":
            self.stdout.write(self.style.SUCCESS("Tudo funcionando."))
        elif resultados and resultados[0].status == "falha":
            self.stdout.write(
                self.style.ERROR(
                    "O banco está fora: o site não abre e nada é gravado. Resolva o banco primeiro."
                )
            )
