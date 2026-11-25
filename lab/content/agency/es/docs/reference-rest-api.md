title: Referencia de la API REST

{{short}} Starter expone el contenido de las páginas mediante la API REST de [Payload](https://payloadcms.com). La API se ejecuta junto con la aplicación de [Next.js](https://nextjs.org), por lo que un mismo despliegue puede servir páginas renderizadas y respuestas JSON. Puedes usarla para recuperar campos de páginas, inspeccionar datos de bloques o crear un frontend independiente. Esta referencia describe la colección `pages` del starter y su flujo de lectura pública.

## Endpoint y modelo de contenido

El endpoint de la colección es `/api/pages`. Una solicitud a `/api/pages/{id}` devuelve una página según su ID de documento en Payload; el endpoint de la colección devuelve una lista paginada. El starter utiliza el campo `slug` para buscar páginas por ruta, en lugar de usar el slug como ID del documento.

Cada página tiene un `title`, un `slug` y un array `layout`. El array contiene los bloques en el orden editorial. Cada bloque incluye un `blockType` que identifica su esquema; por ejemplo, un bloque `hero` tiene un campo `heading`. Las definiciones de los bloques se encuentran en `src/blocks/`, y la colección de páginas las incluye en su campo de layout.

Las rutas de la API se montan en `/api` mediante el controlador de rutas de Payload en el App Router. El archivo `starter.config.ts` del starter contiene la configuración del proyecto; no es el esquema de las respuestas de la API. Para conocer los archivos relacionados, consulta [cómo se organiza el repositorio]({{site}}/docs/getting-started/project-structure/).

## Consultar una página por slug

Define `SITE_URL` en la shell con el origen de la aplicación en ejecución y luego haz una solicitud al endpoint de la colección. Este ejemplo solicita la página cuyo slug es `home` y evita que se expandan los campos de relación:

```bash
curl -G "${SITE_URL}/api/pages" \
  --data-urlencode 'where[slug][equals]=home' \
  --data-urlencode 'depth=0'
```

Una respuesta correcta de la colección contiene un array `docs`, incluso cuando el filtro coincide con una sola página. Un array vacío significa que ninguna página accesible coincidió con la consulta; no equivale a una solicitud fallida. Esta es una respuesta abreviada:

```json
{
  "docs": [
    {
      "id": "65f2a8c41b6e7d0098123456",
      "title": "Home",
      "slug": "home",
      "layout": [
        {
          "id": "65f2a8c41b6e7d0098123457",
          "blockType": "hero",
          "heading": "Make content work harder"
        }
      ],
      "_status": "published"
    }
  ],
  "totalDocs": 1,
  "limit": 10,
  "totalPages": 1,
  "page": 1,
  "hasNextPage": false,
  "hasPrevPage": false
}
```

Payload puede devolver campos adicionales, como marcas de tiempo y campos añadidos al esquema de la colección. Lee los campos que necesita tu aplicación sin considerar este ejemplo como un esquema de respuesta completo.

## Opciones de consulta

Estos parámetros se aplican a las consultas de colección. Combínalos en la cadena de consulta para acotar los resultados o controlar el tamaño de la respuesta.

| Parámetro | Función | Ejemplo |
| --- | --- | --- |
| `where[slug][equals]` | Devuelve documentos cuyo slug coincide exactamente. | `home` |
| `depth` | Controla hasta qué nivel se expanden los documentos relacionados. Usa `0` para obtener IDs en lugar de relaciones expandidas. | `0` |
| `limit` | Define el número máximo de documentos en una respuesta. | `10` |
| `page` | Selecciona una página de resultados, a partir de `1`. | `2` |
| `sort` | Ordena por un campo; añade `-` al inicio del campo para ordenar de forma descendente. | `-createdAt` |
| `draft` | Solicita contenido en borrador cuando los borradores están habilitados y quien hace la solicitud tiene acceso. | `true` |

La paginación se aplica después del filtrado. Comprueba `hasNextPage` antes de solicitar otra página y no supongas que una respuesta de la colección contiene todos los documentos. Usa un valor bajo de `depth` para listar páginas cuando no necesites expandir las relaciones.

## Lectura desde un componente de servidor

La siguiente función auxiliar consulta la API desde el código de la aplicación que se ejecuta en el servidor. Define `SITE_URL` tanto en el entorno de la aplicación como en la shell si usas el comando curl anterior. La función comprueba la respuesta HTTP antes de leer el JSON y devuelve `null` si no hay resultados.

```ts
type Page = {
  id: string
  title: string
  slug: string
}

type PageResult = {
  docs: Page[]
}

export async function getPage(slug: string): Promise<Page | null> {
  const origin = process.env.SITE_URL
  if (!origin) throw new Error('SITE_URL is required')

  const url = new URL('/api/pages', origin)
  url.searchParams.set('where[slug][equals]', slug)
  url.searchParams.set('depth', '0')
  url.searchParams.set('limit', '1')

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Page request failed: ${response.status}`)
  }

  const result = (await response.json()) as PageResult
  return result.docs[0] ?? null
}
```

El tipo de este ejemplo solo cubre los campos que la función devuelve a quien la invoca; no valida el JSON en tiempo de ejecución. Añade los campos de bloque que utiliza tu renderizador y valida las respuestas en el punto de entrada si los datos provienen de un despliegue que no controlas. La solicitud sin caché prioriza el contenido actualizado; si tu aplicación necesita caché, elige una estrategia por separado.

## Acceso, borradores y cambios

El acceso de lectura pública del starter se limita a las páginas publicadas. Por lo tanto, una consulta pública por slug no expone un borrador sin publicar. Los editores pueden solicitar contenido en borrador mediante una sesión autenticada de Payload, conforme a las reglas de acceso de la colección.

> **Nota:** No incluyas credenciales de editor ni tokens de API con privilegios en el código que se ejecuta en el navegador. Mantén las solicitudes autenticadas en el servidor y concede a cada usuario o servicio solo el acceso que necesita.

Cuando cambies el modelo de contenido, sigue esta secuencia:

1. Actualiza el esquema de la página o del bloque y comprueba las reglas de acceso de la colección.
2. Crea o edita una página en el panel de administración de Payload y publícala para que sea accesible públicamente.
3. Consulta el endpoint con el slug de la página e inspecciona el `layout` devuelto.
4. Actualiza el renderizador del frontend para que gestione los tipos de bloques y campos que recibe.

Para crear un bloque, sigue la guía para [crear otro bloque de página]({{site}}/docs/recipes/add-a-block/). Si la aplicación que consume la API también renderiza metadatos de búsqueda, consulta la guía para [definir títulos y descripciones de páginas]({{site}}/docs/guides/seo-metadata/). Trata los cambios de esquema como cambios en la API: actualiza las aplicaciones que la consumen antes de eliminar o cambiar el nombre de los campos de los que dependen.
