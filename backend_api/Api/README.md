# API Backend

Este é um projeto backend desenvolvido com Django e Django REST Framework, oferecendo uma API robusta com autenticação JWT e integração com Firebase.

## 🚀 Tecnologias

- Python 3.12
- Django 5.2
- Django REST Framework
- PostgreSQL
- Docker
- Firebase Admin SDK
- JWT Authentication

## 📋 Pré-requisitos

- Python 3.12 ou superior
- Docker e Docker Compose
- PostgreSQL
- Conta Firebase (para funcionalidades que utilizam Firebase)

## 🔧 Instalação

### Usando Docker (Recomendado)

1. Clone o repositório:
```bash
git clone [URL_DO_REPOSITÓRIO]
cd Api
```

2. Configure as variáveis de ambiente:
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

3. Execute com Docker:
```bash
docker-compose up --build
```

### Instalação Local

1. Clone o repositório:
```bash
git clone [URL_DO_REPOSITÓRIO]
cd Api
```

2. Crie e ative um ambiente virtual:
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# ou
.\venv\Scripts\activate  # Windows
```

3. Instale as dependências:
```bash
pip install -r requirements.txt
```

4. Configure as variáveis de ambiente:
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

5. Execute as migrações:
```bash
python manage.py migrate
```

6. Inicie o servidor:
```bash
python manage.py runserver
```

## 📁 Estrutura do Projeto

```
Api/
├── User/                 # Aplicação de usuários
├── Api/                  # Configurações principais do projeto
├── manage.py            # Script de gerenciamento do Django
├── requirements.txt     # Dependências do projeto
├── Dockerfile          # Configuração do Docker
└── wait-for-postgres.sh # Script para aguardar o PostgreSQL
```

## 🔐 Autenticação

O projeto utiliza JWT (JSON Web Tokens) para autenticação. Para obter um token:

```bash
POST /api/token/
{
    "username": "seu_usuario",
    "password": "sua_senha"
}
```

## 🛠️ Desenvolvimento

### Executando Testes

```bash
python manage.py test
```

### Criando Migrações

```bash
python manage.py makemigrations
python manage.py migrate
```

## 📝 Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```
DEBUG=True
SECRET_KEY=sua_chave_secreta
DATABASE_URL=postgres://user:password@localhost:5432/dbname
FIREBASE_CREDENTIALS_PATH=caminho/para/credenciais.json
```

## 🤝 Contribuindo

1. Faça um Fork do projeto
2. Crie uma Branch para sua Feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a Branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença [MIT](LICENSE).

## 📧 Contato

[Seu Nome] - [seu.email@exemplo.com]

Link do Projeto: [https://github.com/seu-usuario/seu-repositorio](https://github.com/seu-usuario/seu-repositorio) 