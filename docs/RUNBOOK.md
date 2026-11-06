# Runbook operativo

## Arranque local

```bash
cd ~/Documentos/Proyectos/gge-storm-dungeons
set -a; . .env; set +a

# 1) bridge del juego (sin Chrome)
cd apps/empire-api
PORT=3100 API_PATH_SECRET="$GGE_API_SECRET" API_KEY="$API_KEY" node server.js

# 2) collector (en otra terminal)
cd ../..
npm run collector

# 3) web (opcional para desarrollo)
npm run web          # http://127.0.0.1:4300
```

El collector agenda:

| Job | Cron | Qué hace |
|---|---|---|
| storm | `*/10 * * * *` | 540/540 fortalezas e islas |
| dungeons cooldowns | `*/15 * * * *` | refresca los dungeons vencidos |
| dungeons init | `5 3 * * 1` UTC | 507 `gaa`, 3 reinos; descubre nuevos y refresca |

Además, al arrancar ejecuta el init si `scrape_state.dungeons_init` no existe o tiene más de
7 días. Si el job de cooldowns está corriendo en ese momento, reintenta en 10 minutos.

## Verificar que el init corrió

```sql
select * from public.scrape_state where key = 'dungeons_init';
select job, ok, rows, started_at, finished_at, error
from public.scrape_runs
where job = 'dungeons-init'
order by id desc limit 5;
select count(*) from public.dungeons;
```

`scrape_state.dungeons_init.value` debe tener `completed_at`, `dungeons`, `tiles` y `failed`.
Si `failed > 20`, la corrida se marca como error y no actualiza el checkpoint; se reintenta en
el siguiente arranque/cron.

## Cuenta del juego baneada o login rechazado

- `lli` status **27** = `IS_BANNED` (cuenta baneada). **No reintentar en loop**: empeora.
- Parar el empire-api y el collector.
- Revisar la cuenta en el juego. Usar una **cuenta dedicada** para el scraper; no la principal.
- Cuando haya una cuenta sana, actualizar `GGE_USERNAME`/`GGE_PASSWORD` en `.env` y arrancar.
  El init se dispara solo porque el checkpoint no se actualizó.
- El token (`API_KEY`/`GGE_API_TOKEN`) no cambia al cambiar de cuenta.

## Rotar el token de empire-api

1. Generar uno nuevo: `openssl rand -hex 24`.
2. Poner el mismo valor en `.env`:
   ```env
   API_KEY=<nuevo>
   GGE_API_TOKEN=<nuevo>
   ```
3. Reiniciar empire-api y collector.
4. En Render, actualizar `API_KEY` y redesplegar.

Sin `X-API-Key` (o `Authorization: Bearer`) los comandos dan 401; el path secreto solo no
alcanza cuando ambos factores están configurados. `/status` y `/ready` quedan públicos.

## Render

- Servicio Docker free, `healthCheckPath: /status`.
- Variables: `GGE_USERNAME`, `GGE_PASSWORD`, `GGE_ZONE=EmpireEx_25`, `API_PATH_SECRET`,
  `API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `start.sh` arma `GGE_API_URL` con el path secreto y copia `API_KEY` a `GGE_API_TOKEN`.
- Mantener despierto con cron-job.org a `/status` cada 10 min.
- No correr el empire-api local con la misma cuenta al mismo tiempo.

## Tests

```bash
npm run test:permissions   # requiere .env con SUPABASE_URL y la anon key
npm run test:init-plan     # plan 507 tiles + parser gaa + checkpoint 7 días
npm run test:smoke         # web local; falla si aparece el toast
```

CI (`.github/workflows/ci.yml`) corre build del collector, plan/parser/checkpoint y typecheck
del frontend en cada push/PR, sin secretos.

## Pages

- Workflow `.github/workflows/pages.yml` compila con `--base-href=/gge-storm-dungeons/`,
  reescribe `/assets/` y publica `dist/browser`.
- Los deep links (`/storm-tracker`, `/dungeons`) devuelven HTTP 404 porque Pages sirve
  `404.html`, pero el archivo carga la SPA; es el comportamiento esperado.
- El sitio es independiente del collector: si el juego está caído, muestra los últimos datos
  guardados en Supabase.

## Seguridad

- `anon` solo tiene `SELECT` sobre las 7 vistas; tablas base sin grants y RLS activo.
- `service_role` solo vive en `.env`/Render; nunca en el frontend.
- Las vistas son `security definer` y de solo lectura; no hay DML para roles públicos.
- El token de empire-api no va al navegador.
