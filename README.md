# Bodor Sketch → STEP

Web app (Next.js 14 + Vercel) que convierte una foto de un plano de taller en un archivo **.STEP** para la cortadora láser **Bodor K1** (3 kW, O₂/N₂).

Flujo:

1. Sube una foto del plano (pletinas, tubos, perfiles).
2. `claude-opus-4-7` con visión extrae una lista estructurada de piezas (tipo, dimensiones, agujeros, ingletes).
3. `opencascade.js` (en un Web Worker del navegador) construye el sólido B-Rep estanco.
4. Visor 3D con `react-three-fiber` para rotar la pieza.
5. Descarga del `.STEP` (AP214, unidades en mm) listo para el postprocesador Bodor.

## Stack

- Next.js 14 App Router + TypeScript
- Tailwind CSS
- `@react-three/fiber` + `@react-three/drei`
- `opencascade.js` en Web Worker (vía Comlink)
- `@anthropic-ai/sdk` (prompt caching en system + schema)

## Perfiles soportados en v1

- **Pletina plana** (`flat_bar`) con agujeros pasantes y avellanados.
- **Tubo redondo** (`round_tube`) con perforaciones radiales.
- **Tubo cuadrado** (`square_tube`) con perforaciones en las 4 caras.
- **Perfil en L** (`angle_profile`): reconocido por el modelo, geometría en v1.1.

## Arrancar en local

```bash
npm install
cp .env.example .env.local
# edita .env.local y pon tu ANTHROPIC_API_KEY
npm run dev
```

Abrir http://localhost:3000.

## Scripts

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción
- `npm run typecheck` — comprueba tipos sin emitir
- `npm run test` — Vitest (schemas + validaciones)

## Despliegue en Vercel (producción)

1. Conecta el repo `JILMS/Bodork1` en Vercel.
2. Framework: Next.js (autodetectado).
3. Variable de entorno: `ANTHROPIC_API_KEY`.
4. Cada push a `main` dispara un deploy a producción automáticamente.

Política del proyecto: los cambios se hacen directos en `main` para desplegar
a prod (sin PRs intermedias).

## Notas técnicas

- El archivo `.wasm` de opencascade (~15 MB) se sirve desde el cliente y se
  cachea un año (header `Cache-Control: public, max-age=31536000, immutable`).
- Las operaciones booleanas (múltiples `Cut`) se ejecutan en un Web Worker
  para no bloquear la UI.
- Antes de escribir el STEP se valida el sólido con `BRepCheck_Analyzer`; si
  no es estanco, la UI avisa con un indicador amarillo.
- Unidades forzadas a mm: `xstep.cascade.unit = MM`, `write.step.unit = MM`,
  schema AP214. Compatible con el CAM de Bodor.

## Fuera de alcance (por ahora)

- Nesting automático sobre chapa.
- Estimación de tiempos de corte.
- PDFs multi-página.
- Autenticación de usuarios.
