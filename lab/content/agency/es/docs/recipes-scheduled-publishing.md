title: Publicación programada

La publicación programada permite a un editor preparar una página y hacerla pública a una hora determinada sin tener que estar conectado en ese momento. Esta receta utiliza [Payload](https://payloadcms.com) para los registros de las páginas y una ruta protegida de [Next.js](https://nextjs.org) para publicar las páginas cuya hora de publicación ya ha llegado. Utiliza una única copia de trabajo de cada página en lugar de los borradores de Payload: los cambios en una página ya publicada son visibles de inmediato.

## Añadir campos de programación

Añade la siguiente colección en `src/collections/Pages.ts`. El ejemplo presupone que las definiciones de bloque `Hero` y `RichText` del proyecto inicial se exportan desde `src/blocks/`. Registra `Pages` en la configuración de Payload si aún no lo está.

```ts
import type { CollectionConfig } from 'payload'
import { Hero } from '../blocks/Hero'
import { RichText } from '../blocks/RichText'

export const Pages: CollectionConfig = {
  slug: 'pages',
  access: {
    read: ({ req }) =>
      req.user ? true : { visibility: { equals: 'published' } },
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'private',
      options: ['private', 'scheduled', 'published'],
    },
    {
      name: 'publishAt',
      type: 'date',
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    { name: 'layout', type: 'blocks', blocks: [Hero, RichText] },
  ],
}
```

La colección da acceso a todas las páginas a los usuarios autenticados y limita el acceso público de lectura a las páginas publicadas. Adapta estas reglas si tu proyecto tiene roles de editor diferenciados. Los campos cumplen las siguientes funciones:

| Campo | Función |
| --- | --- |
| `title` | Identifica la página en la interfaz de administración y aparece en ella. |
| `slug` | Proporciona el segmento único de la ruta que se usa para encontrar la página. |
| `visibility` | Controla si la página es privada, está programada o está publicada. |
| `publishAt` | Almacena la fecha y la hora a partir de las cuales se puede publicar una página programada. |
| `layout` | Contiene los bloques de la página; no determina su estado de publicación. |

Una página programada debe tener `visibility` establecido en `scheduled` y un valor en `publishAt`. Si falta la fecha, no se publicará. El contenido de los bloques puede incluir imágenes; consulta la [guía de gestión de imágenes]({{site}}/docs/guides/image-handling/) al prepararlas para una página.

## Crear la ruta de publicación

Añade `src/app/api/publish-scheduled/route.ts`. Esta ruta busca hasta 100 páginas cuya hora de publicación ya ha llegado y cambia su visibilidad. Las páginas restantes se procesan en una ejecución posterior.

```ts
import config from '@payload-config'
import { getPayload } from 'payload'

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET

  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const payload = await getPayload({ config })
  const due = await payload.find({
    collection: 'pages',
    overrideAccess: true,
    depth: 0,
    limit: 100,
    sort: 'publishAt',
    where: {
      and: [
        { visibility: { equals: 'scheduled' } },
        { publishAt: { less_than_equal: new Date().toISOString() } },
      ],
    },
  })

  for (const page of due.docs) {
    await payload.update({
      collection: 'pages',
      id: page.id,
      overrideAccess: true,
      data: { visibility: 'published' },
    })
  }

  return Response.json({ published: due.docs.length })
}
```

La ruta utiliza la API local de Payload sin comprobar los permisos de acceso, por lo que el secreto de autenticación es esencial. Configura `CRON_SECRET` en el servidor con un valor largo y aleatorio; la [guía de configuración del entorno]({{site}}/docs/getting-started/environment-variables/) explica dónde configurar los secretos. Nunca lo expongas en el código del navegador.

Configura un programador para que envíe una solicitud `POST` a `/api/publish-scheduled` con un encabezado `Authorization` que contenga `Bearer` seguido del secreto. Ejecútalo una vez por minuto y configúralo para que las solicitudes no se superpongan. La ruta no utiliza un mecanismo atómico para reservar páginas para su procesamiento: evita editar páginas programadas mientras haya una ejecución de publicación en curso.

> **Nota:** El programador determina la precisión de la hora de publicación. Una página puede publicarse a partir de la hora elegida, pero solo aparece después de una ejecución correcta. Si una ejecución falla, la siguiente ejecución correcta vuelve a intentar publicar las páginas que siguen programadas.

## Leer solo las páginas públicas

La ruta pública de la página debe respetar la regla de acceso de lectura de la colección. En `src/app/[slug]/page.tsx`, usa `overrideAccess: false` y evita guardar el resultado en caché para que una página recién publicada pueda aparecer en la siguiente solicitud.

```tsx
import config from '@payload-config'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import { RenderBlocks } from '@/components/RenderBlocks'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'pages',
    overrideAccess: false,
    where: { slug: { equals: slug } },
    limit: 1,
  })

  const page = result.docs[0]
  if (!page) notFound()

  return (
    <main>
      <h1>{page.title}</h1>
      <RenderBlocks blocks={page.layout ?? []} />
    </main>
  )
}
```

Este ejemplo presupone que el componente `RenderBlocks` del proyecto inicial renderiza los bloques registrados en la colección. Cuando añadas otro diseño, sigue la [receta de creación de bloques]({{site}}/docs/recipes/add-a-block/) y regístralo en ambos lugares.

## Programar y verificar una página

1. Crea una página, añade sus bloques y guárdala con `visibility` establecido en `private`.
2. Revisa el contenido y las imágenes en la interfaz de administración. Establece en `publishAt` la fecha y la hora previstas; después, cambia `visibility` a `scheduled` y guarda.
3. Antes de la hora programada, solicita la página como visitante sin sesión iniciada. Debería devolver una respuesta de página no encontrada.
4. Después de que se ejecute el programador, comprueba que la página aparezca públicamente y que su visibilidad sea `published`.

Mantén el programador activo después del despliegue y supervisa las solicitudes fallidas. Para retirar una página, cambia su visibilidad a `private`; para programarla de nuevo, establece una fecha nueva y cambia su visibilidad a `scheduled`. Esta receta no conserva una revisión independiente y sin publicar de una página activa, así que utiliza una página separada si es necesario revisar cambios importantes antes de publicarlos.
