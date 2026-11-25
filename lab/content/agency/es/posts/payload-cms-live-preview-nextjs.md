title: Cómo configurar la vista previa en vivo en Payload CMS con Next.js
excerpt: Ofrece a los editores una vista previa segura y ágil del contenido no publicado de Payload en Next.js, con una configuración práctica para acceder a borradores, actualizar los cambios en vivo y probar el flujo de trabajo.

seoTitle: Vista previa en vivo de Payload CMS con Next.js: guía de configuración

seoDescription: Configura la vista previa en vivo de Payload en Next.js con acceso a borradores, un iframe en el editor y actualizaciones instantáneas; después, prueba el flujo antes del lanzamiento.

[Payload](https://payloadcms.com) permite a los editores ver una versión actualizada de una página mientras trabajan, y [Next.js](https://nextjs.org) puede renderizar esa vista previa con los mismos componentes que utiliza el sitio público. Es importante distinguir que un borrador no es automáticamente una vista previa en vivo: necesitas una forma protegida de cargar contenido no publicado, un iframe en el editor y un mecanismo que escuche y aplique los cambios sin esperar a un despliegue público.

## Define qué debe mostrar la vista previa

Esta guía utiliza una colección `pages` con título, slug y cuerpo en texto plano. Payload y el sitio de Next.js se ejecutan en la misma aplicación y comparten origen, de modo que la cookie de autenticación del editor puede llegar a la ruta de vista previa. El ejemplo supone que se utilizan TypeScript, el App Router de Next.js y la API local de Payload.

Un editor abre una página existente en Payload, accede a la vista previa en vivo y ve el sitio en `/pages/[slug]`. La página inicial se carga a partir del último borrador guardado. A medida que el editor modifica los campos, Payload envía las actualizaciones a la ventana de vista previa, donde un hook de React actualiza el contenido mostrado.

| Elemento | Responsabilidad | Qué comprobar |
|---|---|---|
| Borradores de Payload | Guardar los cambios no publicados | Los borradores están habilitados en la colección |
| Ruta de vista previa | Autenticar al editor y activar el modo borrador | Se rechazan las solicitudes no autenticadas |
| Página de Next.js | Obtener la versión adecuada | Las solicitudes públicas no pueden leer borradores |
| Hook de vista previa en vivo | Aplicar los cambios del editor en el navegador | El iframe se actualiza al modificar los campos |
| Ruta de salida | Finalizar la sesión de vista previa | Se puede desactivar el modo borrador |

Esta es una vista previa editorial, no un sustituto de la revisión del sitio publicado. Un borrador puede depender de relaciones, configuraciones regionales o servicios externos que se comporten de forma distinta en producción. Ten en cuenta esas dependencias en tu plan de pruebas.

Si estás migrando contenido existente, identifica los campos y patrones de URL antes de conectar el iframe. Una [migración de WordPress a una arquitectura headless]({{site}}/wordpress-to-headless-migration/) suele revelar diferencias entre el slug almacenado y la ruta pública que los editores esperan ver.

## Configura los borradores y el punto de entrada a la vista previa

Primero, habilita los borradores en la colección. Después, configura la URL de vista previa en vivo para que dirija a los editores a través de una ruta que compruebe su sesión y active el modo borrador de Next.js. El siguiente ejemplo también limita las lecturas anónimas a los documentos publicados.

### Colección y ruta

Define `PAYLOAD_PUBLIC_URL` con el origen compartido de la aplicación y `PREVIEW_SECRET` con un valor largo y aleatorio del lado del servidor. Genera los tipos de Payload después de agregar la colección. La ruta utiliza el alias de configuración que suele proporcionar una aplicación de Payload; ajusta la importación si tu proyecto utiliza otro alias.

```ts
// collections/Pages.ts
import type { CollectionConfig } from 'payload'

export const Pages: CollectionConfig = {
  slug: 'pages',
  versions: { drafts: true },
  access: {
    read: ({ req: { user } }) =>
      user ? true : { _status: { equals: 'published' } },
  },
  admin: {
    livePreview: {
      url: ({ data }) => {
        const url = new URL('/api/preview', process.env.PAYLOAD_PUBLIC_URL!)
        url.searchParams.set('secret', process.env.PREVIEW_SECRET!)
        url.searchParams.set('slug', String(data.slug ?? ''))
        return url.toString()
      },
    },
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'body', type: 'textarea' },
  ],
}

// app/api/preview/route.ts
import config from '@payload-config'
import { draftMode } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  const slug = request.nextUrl.searchParams.get('slug') ?? ''

  if (
    !process.env.PREVIEW_SECRET ||
    secret !== process.env.PREVIEW_SECRET ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    return new NextResponse('Invalid preview request', { status: 401 })
  }

  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return new NextResponse('Sign in required', { status: 401 })

  const result = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    draft: true,
    user,
    overrideAccess: false,
  })
  if (!result.docs[0]) {
    return new NextResponse('Page not found', { status: 404 })
  }

  const draft = await draftMode()
  draft.enable()
  return NextResponse.redirect(new URL(`/pages/${slug}`, request.url))
}
```

Registra `Pages` en la configuración de Payload. Los dos comentarios con nombres de archivo del bloque indican que se trata de archivos separados; no deben pegarse en un mismo módulo.

La ruta comprueba tanto el secreto como la sesión de Payload y, al buscar la página, aplica el control de acceso de la colección. La redirección se construye a partir de un slug validado en lugar de aceptar un destino arbitrario. El ejemplo concede a todos los usuarios autenticados de Payload acceso de lectura a todas las páginas; sustituye esa regla por los roles y permisos de documentos de tu organización antes de utilizarla con contenido restringido.

El secreto aparece en la URL del iframe, por lo que no basta por sí solo para autorizar el acceso. También puede aparecer en las herramientas del navegador o en los registros del servidor. Restringe el acceso a los registros, evita registrar las cadenas de consulta siempre que sea posible y cambia el secreto si queda expuesto. En producción, también puedes emitir tokens de vista previa de corta duración y alcance limitado.

### Prepara el modelo de contenido

Crea y guarda una página con un slug como `about` antes de abrir su vista previa. La ruta necesita un documento guardado para poder encontrarlo; en este ejemplo, no puede resolver un documento nuevo sin un slug guardado. Si cambias el slug, también puede ser necesario guardar y volver a abrir la vista previa para que su URL coincida con el documento almacenado.

Para los sitios multilingües, decide si la configuración regional debe formar parte de la ruta o de otra parte explícita de la solicitud. Debe utilizarse la misma configuración regional para obtener el borrador inicial y para las actualizaciones en vivo. Nuestra guía sobre [campos, configuraciones regionales y valores alternativos]({{site}}/blog/headless-cms-localization-guide/) explica las decisiones de modelado que hay detrás de esta elección.

## Renderiza el borrador y recibe los cambios

Instala `@payloadcms/live-preview-react` en la aplicación y define `NEXT_PUBLIC_PAYLOAD_URL` con el origen del servidor de Payload. En este ejemplo, al compartir el mismo origen, es el mismo valor que `PAYLOAD_PUBLIC_URL`. La variable pública contiene una dirección, no un secreto.

El componente de servidor que aparece a continuación obtiene el contenido publicado para los visitantes normales y el contenido del borrador solo cuando el modo borrador está activado y hay un usuario de Payload autenticado. El componente de cliente se suscribe a las actualizaciones en vivo únicamente en modo borrador.

```tsx
// app/pages/[slug]/page.tsx
import config from '@payload-config'
import { draftMode, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import { PageView, PreviewPage } from './preview-page'

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { isEnabled } = await draftMode()
  const payload = await getPayload({ config })
  const { user } = isEnabled
    ? await payload.auth({ headers: await headers() })
    : { user: null }

  if (isEnabled && !user) notFound()

  const result = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 1,
    draft: isEnabled,
    user: user ?? undefined,
    overrideAccess: false,
  })
  const page = result.docs[0]
  if (!page) notFound()

  return isEnabled ? <PreviewPage initialData={page} /> : <PageView page={page} />
}

// app/pages/[slug]/preview-page.tsx
'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import type { Page } from '@/payload-types'

export function PageView({ page }: { page: Page }) {
  return (
    <main>
      <h1>{page.title}</h1>
      <p>{page.body}</p>
    </main>
  )
}

export function PreviewPage({ initialData }: { initialData: Page }) {
  const { data } = useLivePreview<Page>({
    initialData,
    serverURL: process.env.NEXT_PUBLIC_PAYLOAD_URL!,
    depth: 1,
  })

  return <PageView page={data} />
}
```

Ajusta la importación del tipo generado para que coincida con tu proyecto. Los valores de `depth` son iguales para que la consulta inicial y la vista previa en vivo utilicen la misma profundidad de relaciones. Este ejemplo sencillo no tiene campos de relación, pero la configuración cobra importancia cuando una página renderiza documentos vinculados.

El hook recibe mensajes del panel de administración de Payload y actualiza el estado de React. No publica documentos ni pone los borradores a disposición de visitantes anónimos. La página normal sigue solicitando a Payload el contenido publicado con el control de acceso activado.

> **Consejo práctico:** Abre una ventana privada del navegador y solicita una URL de borrador conocida. Una respuesta de página no encontrada es una comprobación útil de que el acceso a la vista previa no se ha filtrado a la ruta pública.

## Ofrece a los editores un flujo de trabajo predecible

Una vista previa solo es útil si los editores saben qué representa. Acuerden la diferencia entre un borrador guardado, un cambio de campo sin guardar y una versión publicada. Después, documenten esa distinción junto al proceso de publicación, no solo en las notas para desarrolladores.

1. Crea o abre una página, agrega su título y slug y guárdala como borrador.
2. Abre la vista previa en vivo y confirma que el iframe muestra la ruta prevista.
3. Cambia el título o el cuerpo y comprueba que la vista previa se actualiza sin publicar.
4. Guarda el borrador, sal del documento y vuelve a entrar para confirmar que la versión guardada se conserva.
5. Publica cuando se apruebe el contenido y, después, comprueba la página pública en una sesión independiente.

Las actualizaciones en vivo pueden revelar problemas de diseño antes que un flujo de guardar y recargar, pero siguen mostrando una sola ruta y un solo tamaño de pantalla. Ofrece a los editores una forma de revisar pantallas estrechas y contenido extenso, especialmente en las etiquetas de navegación, las tarjetas y los encabezados.

En las páginas de comercio electrónico, deja claro qué partes proceden de Payload y cuáles de la plataforma de comercio. Un cambio en un encabezado editorial puede actualizarse de inmediato, mientras que el precio o las existencias siguen llegando de otro servicio. Esta distinción importa tanto si el equipo está [comparando Shopify y Medusa]({{site}}/blog/shopify-vs-medusa-headless/) como si está integrando una tienda existente.

## Protege la vista previa en producción

El modo borrador crea una cookie en el navegador; no es un sistema de identidad. Mantén la comprobación de sesión en cada solicitud de una página en modo borrador, como en el ejemplo, en lugar de depender únicamente de la ruta inicial de vista previa. Aplica el control de acceso de Payload a las llamadas a la API local con `overrideAccess: false` y prueba los permisos reales de cada rol de editor.

Agrega una ruta autenticada que llame a `draftMode().disable()` y redirija a una ruta pública segura. Incluye un enlace a ella en un banner visible de vista previa para que los editores sepan cuándo están viendo contenido en borrador y puedan salir sin borrar las cookies del navegador. No permitas que esa ruta redirija a una URL arbitraria proporcionada por un visitante.

Antes del lanzamiento, revisa estas condiciones:

- El editor y la vista previa utilizan HTTPS en producción, con las cookies configuradas para el origen previsto.
- La política de seguridad de contenido permite que el panel de administración de Payload integre el iframe.
- Las respuestas con borradores no se almacenan en una caché compartida ni se sirven a visitantes anónimos.
- Los usuarios no autorizados no pueden obtener borradores a través de otro endpoint de la API.
- Las variables de entorno y las credenciales de vista previa son distintas en cada entorno.

Si Payload y el frontend pasan a utilizar orígenes separados, revisa la autenticación y el comportamiento de las cookies del navegador en lugar de asumir que este ejemplo seguirá funcionando. Las restricciones de los iframes entre distintos orígenes pueden impedir que la cookie de sesión de Payload llegue al frontend. Utiliza un diseño de autenticación explícito y revisado, y pruébalo en los navegadores que usan tus editores.

Estas decisiones también son útiles al evaluar socios de implementación. Pregunta cómo gestionan los permisos de vista previa, la caché y la transferencia del proyecto; nuestras [preguntas para elegir una agencia]({{site}}/blog/questions-to-ask-headless-cms-agency/) ofrecen un punto de partida para esa conversación.

## Prueba el recorrido completo

Empieza con una página y sigue el recorrido desde un cambio del editor hasta su representación en el iframe. Si la página inicial carga pero los cambios no aparecen, revisa la consola del navegador, la URL del servidor de Payload que se pasa al hook y si la vista previa se ejecuta dentro del iframe de Payload. Si el iframe no llega a cargar, inspecciona la respuesta de la ruta de vista previa, la cookie de sesión y la política de integración en iframes antes de cambiar el código de React.

Prueba por separado los estados publicado y borrador. Un editor debe ver el borrador guardado al entrar en la vista previa; un visitante anónimo debe ver la última versión publicada o una respuesta de página no encontrada si no existe ninguna. Cierra sesión mientras el modo borrador está activo y confirma que la página ya no muestra contenido no publicado.

Después, prueba los elementos de contenido que distinguen a tu sitio: campos opcionales, textos largos, relaciones y bloques personalizados. Compara el borrador guardado inicialmente con el estado en vivo después de una edición. Una vista previa que actualiza un título pero omite una imagen relacionada sin avisar no está lista para el uso editorial.

Para un proyecto nuevo, {{brand}} mantiene {{short}} Starter, de código abierto, para Next.js y un CMS headless. La versión 3.2 se instala con `npx create-headless-starter`. Considera una plantilla inicial como una base, no como prueba de que tus propias reglas de acceso, modelo de contenido y flujo de vista previa ya están configurados.
