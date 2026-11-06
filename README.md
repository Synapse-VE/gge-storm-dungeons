# GGE Storm & Dungeons — HIS1

**En vivo:** https://synapse-ve.github.io/gge-storm-dungeons/
**Repo:** https://github.com/Synapse-VE/gge-storm-dungeons
**Supabase:** proyecto `GGE` (`nadunymqjnzjfyytvfro`)

Tracker independiente para **HIS1 (Hispanoamérica 1, `EmpireEx_25`)** centrado en las dos
herramientas que el tracker oficial no activa para este servidor: **Islas Tempestuosas**
(fortalezas + islas de recursos) y **Fortalezas** (dungeons y cooldowns).

- **Frontend**: Angular 20 estático, con el diseño y el responsive del tracker original, en
  **GitHub Pages**.
- **Datos**: **Supabase** (Postgres + API REST). El navegador lee vistas con la clave pública
  y RLS de solo lectura.
- **Recolector**: Node + `node-cron` que llama al **empire-api** (WebSocket, sin Chrome) y
  escribe en Supabase con `service_role`.
- **empire-api**: copia reducida del fork HIS1, lista para Docker/Render.

```
GitHub Pages (Angular estático)
        │  anon key, solo SELECT
        ▼
Supabase (Postgres + RLS)
        ▲  service_role, upserts
        │
Render / local: empire-api + collector (node-cron)
        │  WebSocket
        ▼
GGE (EmpireEx_25)
```

## Estructura

```
apps/
  web/            Angular 20 (diseño original; solo las dos páginas)
  collector/      storm + dungeons -> Supabase, con node-cron
  empire-api/     bridge WebSocket HIS1 (sin Chrome)
supabase/
  migrations/     schema, vistas, RLS y RPCs
  seed/           players, alliances, dungeons e historial
scripts/          migraciones, rewrite de assets, arranque combinado
.github/workflows/pages.yml
Dockerfile        Render: empire-api + collector en un solo servicio
render.yaml
```

## Requisitos

- Node.js 22+ (probado con 26).
- Una cuenta de juego dedicada en HIS1.
- Un proyecto Supabase (plan free alcanza).
- (Opcional) Render free para producción.

## Configuración local

1. Copiá `.env.example` a `.env` y completá:

```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ACCESS_TOKEN=...        # solo para aplicar migraciones
SUPABASE_PROJECT_REF=...

GGE_API_URL=http://127.0.0.1:3100/<API_PATH_SECRET>
GGE_API_SECRET=<API_PATH_SECRET>
GGE_API_TOKEN=<token>            # mismo valor que API_KEY
API_KEY=<token>                  # segundo factor de empire-api
GGE_ZONE=EmpireEx_25
GGE_USERNAME=<cuenta>
GGE_PASSWORD=<clave>
```

2. Aplicá el schema y los RPCs:

```bash
npm run db:apply
```

3. Instalá dependencias:

```bash
npm --prefix apps/collector install
npm --prefix apps/empire-api install
npm --prefix apps/web install
```

4. Cargá los datos iniciales (6.351 jugadores, 527 alianzas, 1.692 dungeons y su historial):

```bash
npm run seed
```

5. Levantá el bridge del juego (sin Chrome):

```bash
cd apps/empire-api
set -a; . ../../.env; set +a
PORT=3100 API_PATH_SECRET="$GGE_API_SECRET" API_KEY="$API_KEY" node server.js
```

Comprobá `http://127.0.0.1:3100/ready` y después:

```bash
cd ../..
npm run collector:storm     # un barrido completo
npm run collector:dungeons  # refresco de cooldowns
npm run collector           # cron: storm */10, dungeons */15, init lunes 03:00 UTC
```

6. Frontend:

```bash
npm run web        # http://127.0.0.1:4300
```

Rutas: `/storm-tracker` y `/dungeons` (la raíz redirige a Storm).

## Cómo se actualizan los datos

- **Storm**: barrido por anillos de 100×100 alrededor del centro (644,644), radio máximo 151.
  Escribe `storm_forts` / `storm_isles` y actualiza `storm_meta`. La función
  `upsert_storm_scan` conserva `available_at`, calcula `available_since_observed` y
  `last_available_seconds`, y poda objetos que ya no están cuando el barrido fue completo.
- **Dungeons (cooldowns)**: cada 15 min toma los dungeons con `global_available_at <= now()`,
  pide un cuadrado de 12×12 alrededor de cada uno con `gaa` y actualiza
  `global_available_at` / `player_available_at` / `player_id`.
- **Dungeons (init/discovery)**: barrido completo de los 3 reinos (13×13 tiles de 100×100 por
  reino, 507 `gaa`) que descubre dungeons nuevos y refresca cooldowns. Corre automáticamente
  los **lunes 03:00 UTC** y al arrancar si el estado `scrape_state.dungeons_init` tiene más de
  7 días o no existe. No hay paso manual.
- **Cron**: `node-cron` dentro del collector; no depende de Render Cron ni de GitHub Actions.
  En Render se puede mantener el servicio despierto con un ping externo (cron-job.org) a
  `/status`; si se duerme, el sitio sigue leyendo Supabase y el próximo ping retoma.

## Modelo de datos

| Objeto | Uso |
|---|---|
| `players`, `alliances` | nombres, mighty, alianzas y `castles_realm` para el init de dungeons |
| `storm_forts`, `storm_isles` | estado del barrido |
| `storm_meta` | radio, último escaneo, temporada |
| `dungeons`, `dungeons_history` | cooldowns y ataques |
| `scrape_runs` | auditoría de cada corrida |
| `scrape_state` | checkpoints del collector (último init de dungeons) |
| `v_storm_forts`, `v_storm_isles`, `v_storm_meta` | vistas de lectura para el frontend |
| `v_dungeons`, `v_dungeons_meta`, `v_dungeons_history` | ídem |
| `v_players` | búsqueda de jugador y castillos para "cerca de" |

`upsert_storm_scan` y `upsert_dungeons_scan` son `security definer` y solo las puede ejecutar
`service_role`. El rol `anon` únicamente tiene `SELECT` sobre las vistas; las tablas base están
cerradas por RLS y sin grants para `anon`/`authenticated`. Las vistas son de solo lectura
(no hay INSERT/UPDATE/DELETE para roles públicos).

`empire-api` exige **dos factores** cuando están configurados: el path secreto
(`/<API_PATH_SECRET>/...`) y el header `X-API-Key` (o `Authorization: Bearer`). `/status` y
`/ready` quedan públicos para el health check, pero no exponen el secreto.

## Estado verificado (2026-11-05)

- **Pages**: workflow verde, sitio en 200 con datos reales (540 fortalezas, 540 islas,
  1.692 dungeons).
- **Supabase**: schema, vistas, RLS y RPCs aplicados; permisos endurecidos: `anon` solo lee
  las 7 vistas (sin DML) y no toca tablas base. Seed de 6.351 jugadores, 527 alianzas,
  1.692 dungeons, 1.610 ataques y 5.051 `castles_realm`.
- **Toast**: corregido con `getLastUpdates()` desde Supabase; smoke test
  `npm run test:smoke` pasa sin el toast.
- **Local**: `empire-api` en `:3100` con path secret + token, web en `:4300`, collector con
  `node-cron`; storm 540/540 y dungeons OK.
- **Docker**: imagen `gge-storm-dungeons:local` construida (427 MB), lista para Render.
- **Render**: pendiente de deploy; el blueprint y el Dockerfile ya están probados.

## Deploy

### GitHub Pages

El workflow `.github/workflows/pages.yml` compila con
`--base-href=/<repo>/`, reescribe las rutas absolutas `/assets/` y publica
`apps/web/dist/browser`. En el repo: **Settings → Pages → Build and deployment → GitHub
Actions**. La URL queda `https://<usuario>.github.io/<repo>/`.

### Render (cuando toque)

`render.yaml` define **un solo** servicio Docker free con `empire-api` + `collector`
(las 750 h/mes del plan free no alcanzan para dos servicios siempre despiertos). Cargá en el
dashboard `GGE_USERNAME`, `GGE_PASSWORD`, `API_PATH_SECRET`, `API_KEY`, `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY`; el resto ya está en el blueprint. El health check es `/status`.

> Si el WAF de Goodgame bloquea la IP de Render, el README del `empire-api` ya documenta el
> plan B: correr el bridge en una máquina residencial y exponerlo por un túnel.

## Créditos y aviso

- Diseño y componentes originales: [gge-tracker](https://github.com/gge-tracker/gge-tracker).
- Bridge base: [danadum/empire-api](https://github.com/danadum/empire-api), adaptado para HIS1.
- Uso personal/no comercial. No afiliado a Goodgame Studios. Usá una cuenta dedicada y a tu
  propio riesgo.
