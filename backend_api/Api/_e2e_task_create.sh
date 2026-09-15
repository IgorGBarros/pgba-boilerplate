#!/bin/bash
ENC_KEY=$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')
export DEBUG=True SECRET_KEY=test-key ENCRYPTION_KEY="$ENC_KEY" DB_NAME=pgba_test DB_USER=postgres DB_PASSWORD=postgres DB_HOST=localhost DB_PORT=5432 REDIS_URL=redis://localhost:6379/0 PROJECT_TEMPLATES_PATH=/home/claude/pgba-boilerplate/frontend/project-templates ALLOWED_HOSTS=testserver

/tmp/venv3/bin/python manage.py runserver 127.0.0.1:8500 > /tmp/rs_taskcreate.log 2>&1 &
RUNPID=$!
sleep 3

/tmp/venv3/bin/python manage.py shell -c "
from User.models import CustomUser
import uuid
tenant = uuid.uuid4()
u, created = CustomUser.objects.get_or_create(email='taskbug@teste.com', defaults={'name': 'Task Bug', 'tenant_id': tenant})
if created:
    u.set_password('teste123456')
    u.save()
print(tenant)
" > /tmp/tenant_taskbug.txt
TENANT=$(tail -1 /tmp/tenant_taskbug.txt)

TOKEN=$(curl -s -X POST http://127.0.0.1:8500/api/v1/users/token/ -H "Content-Type: application/json" -d '{"email":"taskbug@teste.com","password":"teste123456"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['access'])")

echo "--- criando setor e agente ---"
curl -s -X POST http://127.0.0.1:8500/api/v1/agency/sectors/ -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Comercial"}' > /dev/null
curl -s -X POST http://127.0.0.1:8500/api/v1/agency/agents/ -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Vendedor","role":"Vendas","sector":1,"access_level":"operational"}' > /dev/null

echo "--- EXATO payload que o frontend manda (com project_id: null) ---"
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST http://127.0.0.1:8500/api/v1/agency/tasks/ \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"agent_id":1,"brief":"Fechar relatorio de vendas","task_type":"","project_id":null}'

kill $RUNPID 2>/dev/null
