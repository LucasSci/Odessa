# Odessa Web Runtime

Odessa agora tem como alvo principal o modo web local/rede.

## Variaveis obrigatorias

Crie ou atualize `.env` na raiz do projeto:

```env
ODESSA_ADMIN_PASSWORD=troque-esta-senha
ODESSA_SESSION_SECRET=gere-um-segredo-longo
ODESSA_COOKIE_SECURE=false
ODESSA_COOKIE_SAMESITE=lax
ODESSA_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Use `ODESSA_COOKIE_SECURE=true` somente quando servir a aplicacao por HTTPS.
Use `ODESSA_COOKIE_SAMESITE=none` junto com `ODESSA_COOKIE_SECURE=true` quando a interface estiver em um dominio e a API em outro dominio HTTPS.

## Desenvolvimento

```powershell
npm install
venv\Scripts\python.exe -m pip install -r server\requirements.txt
npm run dev:api
npm run dev
```

Acesse `http://localhost:3000` e entre com a senha configurada em `ODESSA_ADMIN_PASSWORD`.

## Build web local/rede

```powershell
npm run build
venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000
```

Depois do build, o FastAPI serve o frontend em `http://localhost:8000`.
Para acessar de outro dispositivo na rede, use o IP da maquina host e inclua a origem em `ODESSA_ALLOWED_ORIGINS` quando estiver usando frontend separado em desenvolvimento.
