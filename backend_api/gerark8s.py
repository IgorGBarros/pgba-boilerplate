from pathlib import Path

# Estrutura base de arquivos e conteúdos
estrutura_arquivos = {
    "k8s/base/deployment.yaml": """
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: seu-usuario/seu-backend:latest
          ports:
            - containerPort: 8000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: DATABASE_URL
            - name: SECRET_KEY
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: SECRET_KEY
            - name: DJANGO_ALLOWED_HOSTS
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: DJANGO_ALLOWED_HOSTS
            - name: DJANGO_DEBUG
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: DJANGO_DEBUG
""",

    "k8s/base/service.yaml": """
apiVersion: v1
kind: Service
metadata:
  name: backend-service
spec:
  selector:
    app: backend
  ports:
    - port: 8000
      targetPort: 8000
""",

    "k8s/base/kustomization.yaml": """
resources:
  - deployment.yaml
  - service.yaml
secretGenerator:
  - name: backend-secret
    literals:
      - DATABASE_URL=dummy
      - SECRET_KEY=dummy
      - DJANGO_ALLOWED_HOSTS=dummy
      - DJANGO_DEBUG=dummy
generatorOptions:
  disableNameSuffixHash: true
""",

    "k8s/overlays/dev/postgres-deployment.yaml": """
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
spec:
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:15
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: postgres
            - name: POSTGRES_USER
              value: postgres
            - name: POSTGRES_PASSWORD
              value: postgres
""",

    "k8s/overlays/dev/postgres-service.yaml": """
apiVersion: v1
kind: Service
metadata:
  name: postgres-service
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
""",

    "k8s/overlays/dev/secret-dev.yaml": """
apiVersion: v1
kind: Secret
metadata:
  name: backend-secret
type: Opaque
stringData:
  DATABASE_URL: "postgres://postgres:postgres@postgres-service.default.svc.cluster.local:5432/postgres"
  SECRET_KEY: "chave-dev-super-secreta"
  DJANGO_ALLOWED_HOSTS: "localhost,127.0.0.1,backend-service,10.1.0.0/16"
  DJANGO_DEBUG: "True"
""",

    "k8s/overlays/dev/kustomization.yaml": """
resources:
  - ../../base
  - postgres-deployment.yaml
  - postgres-service.yaml
  - secret-dev.yaml
""",

    "k8s/overlays/prod/secret-prod.yaml": """
apiVersion: v1
kind: Secret
metadata:
  name: backend-secret
type: Opaque
stringData:
  DATABASE_URL: "postgres://usuario:senha@host.rds.amazonaws.com:5432/prod_db"
  SECRET_KEY: "chave-prod-super-secreta"
  DJANGO_ALLOWED_HOSTS: "api.seudominio.com"
  DJANGO_DEBUG: "False"
""",

    "k8s/overlays/prod/kustomization.yaml": """
resources:
  - ../../base
  - secret-prod.yaml
"""
}

# Criar os arquivos fisicamente
base_path = Path("./k8s")
for caminho, conteudo in estrutura_arquivos.items():
    arquivo = base_path / Path(caminho).relative_to("k8s")
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    arquivo.write_text(conteudo.strip() + "\n")

str(base_path)
