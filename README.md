# chatgptactionjuris

Action para un Custom GPT de ChatGPT que delega en el [Buscador de Jurisprudencia](https://github.com/introduccionalderechofvp-star/buscador-de-jurisprudencia) sin modificarlo.

Este repo contiene:

- `server.js` — proxy mínimo (Node + Express) que añade auth bearer y reenvía dos endpoints del buscador.
- `openapi.yaml` — schema OpenAPI 3.1 que se pega en el Action del Custom GPT.
- `gpt-instructions.md` — texto sugerido para el campo "Instructions" del GPT.

## Por qué un proxy y no apuntar el Action al buscador

- El buscador no tiene autenticación en sus endpoints. El proxy expone sólo `/search` y `/document` y exige `Authorization: Bearer <ACTION_API_KEY>`.
- El proxy fija `advanced: false` y `rerank: false` (modo económico).
- Recorta la respuesta del buscador para que el GPT reciba sólo lo necesario (rank, filename, organo, file_path, score, text_excerpt).
- Si en el futuro cambiás de URL del buscador, sólo se actualiza una variable de entorno aquí — el Schema del GPT no cambia.

## Setup local

```bash
npm install
cp .env.example .env
# editar .env con BUSCADOR_API_URL y un ACTION_API_KEY (openssl rand -hex 32)
npm start
```

Health check:

```bash
curl http://localhost:8080/health
```

Prueba de búsqueda:

```bash
curl -X POST http://localhost:8080/search \
  -H "Authorization: Bearer $ACTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"responsabilidad civil médica","limit":5}'
```

## Despliegue

El proxy debe estar accesible por HTTPS público (requisito de los Actions de ChatGPT). Cualquier hosting de Node sirve (Railway, Fly.io, Render, un VPS con Caddy/Nginx por delante, etc.). Una vez desplegado:

1. Anotá la URL pública (ej. `https://tu-action.tudominio.com`).
2. Editá `openapi.yaml` y reemplazá el valor de `servers[0].url` por esa URL.

## Cómo conectarlo al Custom GPT

1. En [chat.openai.com](https://chat.openai.com), entrá a *Explore GPTs → Create*.
2. En la pestaña **Configure**:
   - **Name / Description**: lo que prefieras.
   - **Instructions**: pegá el contenido de [`gpt-instructions.md`](./gpt-instructions.md).
3. **Actions → Create new action**:
   - **Authentication**: *API Key*, type *Bearer*, y pegá el valor de `ACTION_API_KEY`.
   - **Schema**: pegá el contenido de [`openapi.yaml`](./openapi.yaml) (con la URL del servidor ya reemplazada).
4. Guardá y probá con preguntas reales.

## Mantenimiento: cuándo hay que tocar este repo

Cambios al buscador que **no** requieren tocar nada acá:
- Mejoras internas: embeddings, RRF, OCR, performance, fixes.
- Más documentos ingestados con `organo` ya conocidos.
- Campos *adicionales* en la respuesta JSON.

Cambios al buscador que **sí** requieren tocar acá:
- Nuevos valores de `organo` → actualizar el `enum` en `openapi.yaml`.
- Renombrar/quitar campos de request o response → actualizar `server.js` y `openapi.yaml`.
- Cambiar nombres de endpoints o parámetros → actualizar `server.js`.
- Cambiar URL pública del proxy → actualizar `servers[0].url` en `openapi.yaml`.
