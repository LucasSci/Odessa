# Deploy Da Odessa Na Vercel

Este deploy publica a interface web da Odessa na Vercel e inclui uma API cloud minima para login, saude e estado de controle. OBS, OCR pesado, captura e videos locais ainda precisam de um Odessa Agent na maquina da live para execucao real.

## Modelo MVP

- Vercel: frontend React/Vite e API cloud minima em `/api`.
- Maquina da live: Odessa Agent/FastAPI local para OBS, captura, OCR local e videos.
- Navegador do operador: abre a URL da Vercel e faz login direto na API cloud.

## Variaveis

Sem `VITE_API_BASE_URL`, a interface hospedada na Vercel usa a API cloud em mesma origem.

Se quiser apontar a UI direto para outro backend, configure na Vercel:

```text
VITE_API_BASE_URL=https://sua-api-ou-tunel/api/v1
```

No backend local, permita a origem da Vercel:

```powershell
$env:ODESSA_ALLOWED_ORIGINS="https://seu-projeto.vercel.app,http://localhost:3000,http://127.0.0.1:3000"
$env:ODESSA_ADMIN_PASSWORD="sua-senha-forte"
$env:ODESSA_SESSION_SECRET="um-segredo-longo"
$env:ODESSA_COOKIE_SECURE="false"
$env:ODESSA_COOKIE_SAMESITE="lax"
venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000
```

Se a API estiver em outro dominio HTTPS, por exemplo um tunel seguro, use:

```powershell
$env:ODESSA_COOKIE_SECURE="true"
$env:ODESSA_COOKIE_SAMESITE="none"
```

## Comandos

```powershell
npm run build
npx vercel
npx vercel --prod
```

Se a Vercel pedir login:

```powershell
npx vercel login
```

## Importante

A API cloud atual e uma primeira camada de controle. Ela permite login e painel hospedado, mas nao substitui o agente local enquanto a Odessa depender de OBS, captura de tela, videos locais e automacao da maquina da live.
