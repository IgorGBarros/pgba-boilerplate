# Documentação do Projeto Backend

## Visão Geral
Este é um projeto backend desenvolvido em Django, com suporte a Docker e Kubernetes para containerização e orquestração.

## Estrutura do Projeto
```
.
├── Api/                    # Diretório principal da aplicação Django
│   ├── User/              # Módulo de usuários
│   ├── Api/               # Configurações principais do Django
│   ├── manage.py          # Script de gerenciamento do Django
│   ├── requirements.txt   # Dependências do projeto
│   └── Dockerfile        # Configuração do container Docker
├── k8s/                   # Configurações do Kubernetes
├── docker-compose.yml     # Configuração do ambiente Docker
└── README.md             # Documentação principal do projeto
```

## Requisitos do Sistema
- Python 3.x
- Docker
- Docker Compose
- Kubernetes (opcional, para deploy)

## Configuração do Ambiente

### Usando Docker
1. Clone o repositório
2. Execute o comando:
```bash
docker-compose up --build
```

### Desenvolvimento Local
1. Crie um ambiente virtual:
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows
```

2. Instale as dependências:
```bash
pip install -r Api/requirements.txt
```

3. Execute as migrações:
```bash
python Api/manage.py migrate
```

4. Inicie o servidor:
```bash
python Api/manage.py runserver
```

## Componentes Principais

### API Django
O projeto utiliza Django como framework principal, com uma estrutura modular que inclui:
- Sistema de autenticação de usuários
- API RESTful
- Banco de dados SQLite (desenvolvimento) / PostgreSQL (produção)

### Containerização
- `Dockerfile`: Define a imagem do container da aplicação
- `docker-compose.yml`: Configura os serviços necessários (API, banco de dados)
- `wait-for-postgres.sh`: Script para garantir que o banco de dados esteja pronto antes de iniciar a aplicação

### Kubernetes
O diretório `k8s/` contém as configurações para deploy em um cluster Kubernetes, incluindo:
- Deployments
- Services
- ConfigMaps
- Secrets

## Desenvolvimento

### Convenções de Código
- Seguir as convenções PEP 8 para Python
- Documentar funções e classes usando docstrings
- Manter o código modular e testável

### Testes
Para executar os testes:
```bash
python Api/manage.py test
```

## Deploy

### Produção
1. Configure as variáveis de ambiente necessárias
2. Execute o deploy usando Kubernetes:
```bash
kubectl apply -f k8s/
```

### Monitoramento
- Logs podem ser acessados via Kubernetes:
```bash
kubectl logs -f deployment/api-deployment
```

## Manutenção

### Backup do Banco de Dados
```bash
python Api/manage.py dumpdata > backup.json
```

### Restauração do Banco de Dados
```bash
python Api/manage.py loaddata backup.json
```

## Suporte
Para questões e suporte, abra uma issue no repositório do projeto. 
# 📚 Guia Completo: Deploy Django + PostgreSQL no Kubernetes com Kustomize

Este guia detalha todo o processo de implantação de uma aplicação Django com banco de dados PostgreSQL no **Kubernetes (K8s)** usando **Kustomize**, desde a configuração local com Docker Compose até a execução em um cluster real.

---

## 🎯 Objetivo

Implantar e manter funcionando:
- Uma API Django (`igorgbarros/backend:latest`)
- Um banco PostgreSQL persistente
- Ambiente configurado com `kustomize` para múltiplos ambientes (`dev`, `prod`)
- Funcionamento correto dos probes HTTP (`/health/`)
- Conexão segura via Secrets
- Acesso externo via NodePort
- Django Admin com estilos corretos

---

## 🧱 Estrutura do Projeto

```
backend/
├── Dockerfile
├── docker-compose.yml
├── wait-for-postgres.sh
├── manage.py
└── Api/
    ├── settings.py
    └── urls.py

k8s/
├── base/
│   ├── backend-deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
└── overlays/
    └── dev/
        ├── postgres-deployment.yaml
        ├── postgres-service.yaml
        ├── secret-dev.yaml
        └── kustomization.yaml
```

> 💡 O código da aplicação está em `backend/`, e os arquivos de infraestrutura em `k8s/`.

---

## ✅ Requisitos

- [x] Docker instalado
- [x] Kubernetes habilitado no Docker Desktop
- [x] `kubectl` configurado
- [x] Imagem pública: `igorgbarros/backend:latest`
- [x] PowerShell ou terminal funcional

---

## 🔧 Etapa 1: Preparar a Aplicação Django

### 1.1 Crie o script `wait-for-postgres.sh`

```bash
#!/bin/sh

set -e

export DJANGO_SETTINGS_MODULE=Api.settings

echo "Aguardando PostgreSQL iniciar..."
until python manage.py inspectdb > /dev/null 2>&1; do
  echo "PostgreSQL não está pronto - aguardando..."
  sleep 5
done

echo "PostgreSQL iniciado!"

python manage.py migrate --noinput

mkdir -p /app/static
echo "Coletando arquivos estáticos..."
python manage.py collectstatic --noinput || echo "collectstatic falhou, continuando..."

exec gunicorn --bind 0.0.0.0:8000 --timeout 120 Api.wsgi
```

Torne executável:

```powershell
chmod +x wait-for-postgres.sh
```

---

### 1.2 Atualize seu `Dockerfile`

```dockerfile
FROM python:3.12-slim

ENV BASE_DIR=/app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        netcat-openbsd \
        postgresql-client \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR $BASE_DIR

RUN mkdir -p $BASE_DIR/static

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x $BASE_DIR/wait-for-postgres.sh

CMD ["sh", "-c", "$BASE_DIR/wait-for-postgres.sh"]
```

Construa e envie:

```powershell
docker build -t igorgbarros/backend:latest .
docker push igorgbarros/backend:latest
```

---

### 1.3 Adicione rota `/health/` no Django

#### `views.py`

```python
from django.http import HttpResponse

def health_check(request):
    return HttpResponse("OK")
```

#### `urls.py`

```python
from django.urls import path
from .views import health_check

urlpatterns = [
    path('health/', health_check),
]
```

---

### 1.4 Corrija `Api/settings.py` com logs de depuração

Adicione prints para identificar erros silenciosos:

```python
# Api/settings.py

from pathlib import Path
import environ
import os

print("✅ 1. Iniciando carregamento do settings.py")

BASE_DIR = Path(__file__).resolve().parent.parent
print(f"✅ 2. BASE_DIR definido como: {BASE_DIR}")

env = environ.Env(
    DEBUG=(bool, False),
)
try:
    environ.Env.read_env(BASE_DIR / ".env")
except Exception as e:
    print(f"[WARN] Não foi possível carregar .env: {e}")

SECRET_KEY = env('SECRET_KEY', default='django-insecure-fallback-key')
DEBUG = env.bool('DJANGO_DEBUG', default=False)
ALLOWED_HOSTS = env.list('DJANGO_ALLOWED_HOSTS', default=['*'])

print("✅ 3. Segurança carregada")

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'rest_framework',
    'corsheaders',
    'User',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'Api.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'Api.wsgi.application'

# === Banco de dados ===
print("✅ 4. Antes do DATABASES")
try:
    DATABASES = {
        'default': env.db()
    }
    print("✅ 5. DATABASES configurado com sucesso")
except Exception as e:
    print(f"❌ ERRO ao configurar DATABASES: {e}")
    raise

# === Arquivos estáticos ===
print("✅ 6. Definindo STATIC_ROOT...")
try:
    STATIC_URL = '/static/'
    STATIC_ROOT = str(BASE_DIR / 'static')
    print(f"✅ 7. STATIC_ROOT definido como: {STATIC_ROOT}")
except Exception as e:
    print(f"❌ ERRO ao definir STATIC_ROOT: {e}")

STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
```

---

## 🌐 Etapa 2: Configurar Docker Compose (Ambiente Local)

Crie `docker-compose.yml` na raiz:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: 02122015Pedro
      POSTGRES_DB: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build: ../backend
    command: bash -c "./wait-for-postgres.sh"
    environment:
      - DATABASE_URL=postgres://postgres:02122015Pedro@postgres:5432/postgres
      - DJANGO_DEBUG=True
      - DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0
      - SECRET_KEY=super-seguro
      - TZ=America/Sao_Paulo
      - PYTHONUNBUFFERED=1
    ports:
      - "8000:8000"
    depends_on:
      - postgres
    volumes:
      - ../backend:/app

volumes:
  postgres_data:
```

> ⚠️ Use `postgres` como host — NÃO use `postgres-service.app-ns.svc.cluster.local`

Teste:

```powershell
docker-compose up
```

Acesse: `http://localhost:8000/health/`

---

## ☸️ Etapa 3: Configurar Kubernetes com Kustomize

### 3.1 Crie `base/backend-deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
meta
  name: backend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backend
  template:
    meta
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: igorgbarros/backend:latest
          ports:
            - containerPort: 8000
          envFrom:
            - secretRef:
                name: backend-secret
          env:
            - name: DJANGO_SETTINGS_MODULE
              value: Api.settings
          livenessProbe:
            httpGet:
              path: /health/
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health/
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 5
```

---

### 3.2 Crie `base/service.yaml`

```yaml
apiVersion: v1
kind: Service
meta
  name: backend-service
spec:
  selector:
    app: backend
  ports:
    - protocol: TCP
      port: 8000
      targetPort: 8000
      nodePort: 30080
  type: NodePort
```

---

### 3.3 Crie `base/kustomization.yaml`

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - backend-deployment.yaml
  - service.yaml
```

---

### 3.4 Crie `overlays/dev/kustomization.yaml`

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base
  - postgres-deployment.yaml
  - postgres-service.yaml
  - secret-dev.yaml

namespace: app-ns
```

---

### 3.5 Crie `overlays/dev/secret-dev.yaml`

```yaml
apiVersion: v1
kind: Secret
meta
  name: backend-secret
  namespace: app-ns
type: Opaque

  POSTGRES_DB: cG9zdGdyZXMK # "postgres"
  POSTGRES_USER: cG9zdGdyZXM= # "postgres"
  POSTGRES_PASSWORD: MDIwMjIwMTVQZWRybwo= # "02122015Pedro"
  DATABASE_URL: cG9zdGdyZXM6Ly9wb3N0Z3JlczowMjEyMjAxNVBlZHJvQHBvc3RncmVzLXNlcnZpY2UuYXBwLW5zLnN2Yy5jbHVzdGVyLmxvY2FsOjU0MzIvcG9zdGdyZXMK
  DJANGO_ALLOWED_HOSTS: bG9jYWxob3N0LDEyNy4wLjAuMSwwLjAuMC4wLDEwLjEuMC4xMDA=
  DJANGO_DEBUG: RmFsc2U=
  SECRET_KEY: c3VwZXItc2VjdXJlLXNlY3JldA==
```

> 🔐 Gere Base64 com PowerShell:
>
> ```powershell
> [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("postgres"))
> [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("02122015Pedro"))
> ```

---

### 3.6 Crie `overlays/dev/postgres-deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
meta
  name: postgres
  labels:
    app: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    meta
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:15
          ports:
            - containerPort: 5432
          envFrom:
            - secretRef:
                name: backend-secret
          volumeMounts:
            - name: postgres-storage
              mountPath: /var/lib/postgresql/data
      volumes:
        - name: postgres-storage
          persistentVolumeClaim:
            claimName: postgres-pvc
```

---

### 3.7 Crie `overlays/dev/postgres-service.yaml`

```yaml
apiVersion: v1
kind: Service
meta
  name: postgres-service
spec:
  selector:
    app: postgres
  ports:
    - protocol: TCP
      port: 5432
      targetPort: 5432
```

---

## 🧹 Etapa 4: Limpeza Inicial (Se já tentou antes)

Se você já aplicou recursos anteriormente:

```powershell
kubectl delete namespace app-ns
```

Isso remove tudo dentro do namespace `app-ns`.

Verifique:

```powershell
kubectl get all -A
kubectl get secrets -A
kubectl get pvc -A
```

---

## 🚀 Etapa 5: Aplique Tudo com Kustomize

```powershell
cd C:\Users\ig0r_\Documents\backend\k8s
kubectl create namespace app-ns
kubectl apply -k overlays/dev
```

Esse comando cria:
- Namespace `app-ns`
- Secret com credenciais
- Deployment e Service do Postgres
- Deployment e Service do Backend

---

## ✅ Etapa 6: Verifique se Está Tudo Funcionando

### 6.1 Verifique Pods

```powershell
kubectl get pods -n app-ns --watch
```

Saída esperada:

```
NAME                        READY   STATUS    RESTARTS   AGE
backend-669946666d-blxqd    1/1     Running   0          32s
postgres-6c78c96497-gdgvn   1/1     Running   0          31s
```

✅ Ambos estão prontos!

---

### 6.2 Verifique Services

```powershell
kubectl get service -n app-ns
```

Saída esperada:

```
NAME               TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)
backend-service    NodePort    10.107.105.117   <none>        8000:30080/TCP
postgres-service   ClusterIP   10.96.67.225     <none>        5432/TCP
```

---

### 6.3 Logs do Pod do Backend

```powershell
kubectl logs backend-669946666d-blxqd -n app-ns
```

Saída confirmada:

```
Aguardando o PostgreSQL iniciar...
PostgreSQL não está pronto - aguardando...
PostgreSQL iniciado!
Aplicando migrações Django...
Operations to perform: Apply all migrations
Running migrations: All OK
Iniciando servidor Gunicorn...
[INFO] Starting gunicorn 23.0.0
[INFO] Listening at: http://0.0.0.0:8000
[INFO] Booting worker with pid: 16
```

✅ O Gunicorn está rodando corretamente.

---

### 6.4 Teste com `port-forward`

```powershell
kubectl port-forward svc/backend-service 8000:8000 -n app-ns
```

Saída:

```
Forwarding from 127.0.0.1:8000 -> 8000
Forwarding from [::1]:8000 -> 8000
Handling connection for 8000
```

Acesse no navegador:

```
http://localhost:8000/health/
```

Se retornar `OK`, sua API está funcionando perfeitamente!

---

## 🐳 Diferença Crucial: Docker Compose vs Kubernetes

| Ambiente | `DATABASE_URL` |
|--------|----------------|
| **Docker Compose** | `postgres://postgres:02122015Pedro@postgres:5432/postgres` |
| **Kubernetes** | `postgres://postgres:02122015Pedro@postgres-service.app-ns.svc.cluster.local:5432/postgres` |

➡️ Nunca misture os dois ambientes.

---

## 🚨 Erros Comuns e Soluções

| Erro | Causa | Solução |
|------|-------|---------|
| `could not translate host name "postgres-service.app-ns.svc.cluster.local"` | Tentando usar K8s no Docker Compose | Use `postgres` como host no Docker Compose |
| `CreateContainerConfigError` | Secret faltando ou mal formatado | Verifique `secret-dev.yaml` e aplique com `-k` |
| `CrashLoopBackOff` | Gunicorn terminou ou erro no entrypoint | Garanta que `exec gunicorn` esteja no script |
| `password authentication failed` | Senha incorreta no Secret | Atualize `POSTGRES_PASSWORD` em Base64 |
| `ERR_EMPTY_RESPONSE` | Servidor não responde | Use `port-forward` para teste direto |

---

## 📂 Histórico de Comandos (Corrigido)

```powershell
# Entrar na pasta k8s
cd C:\Users\ig0r_\Documents\backend\k8s

# Ver contexto atual
kubectl config current-context

# Criar namespace
kubectl create namespace app-ns

# Aplicar configuração Kustomize
kubectl apply -k overlays/dev

# Verificar Pods
kubectl get pods -n app-ns --watch

# Verificar Services
kubectl get service -n app-ns

# Ver logs
kubectl logs backend-669946666d-blxqd -n app-ns

# Port-forward
kubectl port-forward svc/backend-service 8000:8000 -n app-ns
```

---

## 🎉 Conclusão

Você agora tem:
- Uma aplicação Django + PostgreSQL funcionando no Kubernetes
- Um ambiente local com Docker Compose
- Estrutura organizada com Kustomize
- Capacidade de debugar erros comuns
- Documentação completa para replicar em qualquer momento

---

## 🚀 Próximos Passos Sugeridos

1. **Adicionar Ingress Controller** (NGINX)
2. **Criar ambiente `prod` em `overlays/prod/`**
3. **Automatizar CI/CD com GitHub Actions**
4. **Monitorar com Prometheus + Grafana**
5. **Usar Helm Chart para maior flexibilidade**

Se quiser, posso gerar um repositório completo no GitHub com tudo isso pronto para uso.

Quer seguir por esse caminho? 😊