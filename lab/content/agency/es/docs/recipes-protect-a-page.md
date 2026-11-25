title: Protege una página con contraseña

Protege una página publicada cuando necesites compartirla con un grupo limitado de personas sin crear cuentas individuales. Esta guía añade un campo de protección con contraseña a la configuración de la página, guarda la contraseña en una variable de entorno del servidor y comprueba una cookie firmada antes de renderizar los bloques de la página. La contraseña se aplica a la ruta de la página, no a los archivos enlazados desde ella.

## Antes de empezar

Esta guía presupone que tienes un proyecto {{short}} Starter con App Router, una colección Pages con borradores habilitados y un renderizador de bloques en `src/components/RenderBlocks.tsx`. Las páginas tienen un `slug` único, un `title` y un campo `layout` que contiene bloques de `src/blocks/`.

La implementación utiliza las API de servidor de [Next.js](https://nextjs.org) y la Local API de [Payload](https://payloadcms.com). Si estás creando un proyecto, consulta los comandos de inicio disponibles en las [opciones de la CLI]({{site}}/docs/reference/cli/).

## Restringe el acceso a la API de Pages

Añade las siguientes exportaciones a `src/collections/pageProtection.ts`. En la configuración de la colección Pages, añade `pageProtectionField` a `fields` y asigna `pageReadAccess` a `access.read`.

```ts
import type { Access, Field } from 'payload'

export const pageProtectionField: Field = {
  name: 'passwordProtected',
  type: 'checkbox',
  defaultValue: false,
  admin: {
    description: 'Require the page password on the public route.',
  },
}

export const pageReadAccess: Access = ({ req }) => {
  // The users collection is reserved for trusted editors.
  if (req.user?.collection === 'users') return true

  return {
    passwordProtected: {
      not_equals: true,
    },
  }
}
```

Esta regla impide que los documentos de páginas protegidas aparezcan en las respuestas de REST y GraphQL de Payload a solicitudes no autenticadas. Los editores de confianza pueden seguir gestionándolos en el panel de administración. Si mantienes esta regla sin cambios, no concedas cuentas en la colección `users` a usuarios que no sean de confianza.

| Campo o configuración | Función | Valor para esta guía |
| --- | --- | --- |
| `slug` | Identifica la ruta pública y la variable de contraseña | Letras minúsculas, números y guiones |
| `title` | Proporciona el título de la página | Cualquier título editorial |
| `layout` | Almacena los bloques de la página | Bloques registrados en la colección Pages |
| `passwordProtected` | Activa la protección con contraseña | `true` para las páginas protegidas |
| Estado del borrador | Determina si la ruta pública puede encontrar la página | Publicada |

No guardes contraseñas en los campos de la página: ni siquiera un campo oculto en la interfaz de administración es un lugar seguro para un secreto compartido. Para obtener orientación sobre cómo separar los campos editoriales de la configuración de la aplicación, consulta la [guía de modelado]({{site}}/docs/guides/content-modeling/).

## Añade la protección del lado del servidor

Sustituye la ruta de la página del frontend en `src/app/(frontend)/[slug]/page.tsx` por el siguiente código. Adapta la importación de `RenderBlocks` si tu proyecto utiliza otro renderizador.

```tsx
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { RenderBlocks } from '@/components/RenderBlocks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function getPage(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) notFound()
  if (slug.length > 64) notFound()

  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 1,
    draft: false,
    overrideAccess: true,
  })

  return result.docs[0]
}

function secrets(slug: string) {
  const key = `PAGE_PASSWORD_${slug.toUpperCase().replaceAll('-', '_')}`
  const password = process.env[key]
  const signingKey = process.env.PAGE_GATE_SECRET

  if (!password) throw new Error(`Missing ${key}`)
  if (!signingKey) throw new Error('Missing PAGE_GATE_SECRET')
  if (signingKey.length < 32) throw new Error('PAGE_GATE_SECRET is too short')

  return { password, signingKey }
}

function token(slug: string, password: string, signingKey: string) {
  return createHmac('sha256', signingKey)
    .update(JSON.stringify([slug, password]))
    .digest('hex')
}

function equal(a: string, b: string) {
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(a), hash(b))
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const page = await getPage(slug)
  if (!page) notFound()

  if (page.passwordProtected) {
    const { password, signingKey } = secrets(slug)
    const expected = token(slug, password, signingKey)
    const supplied = (await cookies()).get('page-access')?.value

    if (!supplied || !equal(supplied, expected)) {
      async function unlock(formData: FormData) {
        'use server'

        const current = await getPage(slug)
        if (!current) notFound()
        if (!current.passwordProtected) redirect(`/${slug}`)

        const { password, signingKey } = secrets(slug)
        const submitted = formData.get('password')
        if (typeof submitted !== 'string') redirect(`/${slug}?error=1`)
        if (submitted.length > 1024) redirect(`/${slug}?error=1`)
        if (!equal(submitted, password)) redirect(`/${slug}?error=1`)

        const store = await cookies()
        store.set('page-access', token(slug, password, signingKey), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: `/${slug}`,
          maxAge: 60 * 60 * 24,
        })
        redirect(`/${slug}`)
      }

      return (
        <main>
          <h1>Enter the page password</h1>
          <form action={unlock}>
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" maxLength={1024} required />
            <button type="submit">Continue</button>
          </form>
        </main>
      )
    }
  }

  return (
    <main>
      <h1>{page.title}</h1>
      <RenderBlocks blocks={page.layout} />
    </main>
  )
}
```

La ruta omite deliberadamente el control de acceso de Payload para obtener el documento en el servidor. No renderiza ni el título ni los bloques hasta que se haya comprobado la cookie. Si cambia la contraseña de la página o la clave de firma, las cookies existentes dejan de ser válidas.

## Configura y prueba

1. Crea una página con el slug `partner-preview`, activa **Password protected** y publícala.
2. Añade los secretos a tu entorno local. Ejecuta este comando una sola vez en la raíz del proyecto:

   ```bash
   printf 'PAGE_GATE_SECRET=%s\nPAGE_PASSWORD_PARTNER_PREVIEW=%s\n' \
     "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" >> .env.local
   ```

3. Reinicia el servidor de desarrollo. Obtén la contraseña de página generada en `.env.local` e introdúcela en `/partner-preview`.
4. Haz la prueba en una ventana privada del navegador: una contraseña incorrecta no debe revelar el contenido. Comprueba también que una solicitud no autenticada a la API de Pages de Payload no devuelva el documento protegido.
5. Configura las mismas dos variables en tu entorno de despliegue antes de publicar. Mantén `.env.local` fuera del control de versiones.

> **Nota:** Esta protección no cubre las URL directas de los archivos subidos, el contenido copiado en otra colección ni las rutas alternativas que omitan la comprobación. Para los archivos confidenciales, utiliza almacenamiento privado y mecanismos de entrega que verifiquen la autorización. No almacenes respuestas protegidas en la caché de una CDN compartida.

Cuando añadas un bloque nuevo, comprueba que no exponga contenido protegido a través de otro endpoint. La [guía de bloques]({{site}}/docs/recipes/add-a-block/) explica cómo registrar y renderizar bloques.
