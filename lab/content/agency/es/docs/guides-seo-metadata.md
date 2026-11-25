title: Metadatos SEO

{{short}} Starter genera los metadatos de las páginas a partir de campos en Payload CMS y los devuelve mediante la API de metadatos del App Router de Next.js. Los editores pueden definir un título, una descripción y una imagen para redes sociales para cada página, mientras que los valores predeterminados del sitio se aplican a las páginas que no necesitan valores personalizados. Esta guía explica los campos, la función de metadatos y las comprobaciones que deben realizarse antes de publicar.

## Definir los valores predeterminados del sitio

El starter combina [Payload](https://payloadcms.com) para la edición de contenido con [Next.js](https://nextjs.org) para la renderización. Guarda la URL pública del sitio y los metadatos predeterminados en `starter.config.ts`. Define `SITE_URL` en cada entorno de despliegue con el origen público correspondiente.

```ts
const siteUrl = process.env.SITE_URL

if (!siteUrl) {
  throw new Error('SITE_URL is required to generate metadata')
}

export const starterConfig = {
  seo: {
    siteUrl,
    defaultTitle: 'Website',
    defaultDescription: 'Explore our pages and services.',
    defaultOgImage: '/images/social-default.png',
  },
} as const
```

La ruta de la imagen predeterminada es relativa al origen del sitio. Añade el archivo en `public/images/social-default.png` para que esté disponible en todos los despliegues. Usa una imagen lo suficientemente grande para compartirla en redes sociales; una imagen de 1200 por 630 píxeles es un buen punto de partida.

La configuración del starter es código TypeScript convencional: la función de metadatos la importa en lugar de depender de un cargador automático de configuración. Consulta las [opciones de configuración]({{site}}/docs/reference/configuration/) para conocer el resto de los ajustes del starter.

## Añadir campos al modelo de página

La colección `Pages` del starter almacena los metadatos en un grupo `seo`. El grupo es opcional, por lo que un editor puede publicar una página sin completar todos los campos. Añade el grupo al definir la colección y vuelve a generar los tipos de Payload después de cambiar el esquema. La [guía de modelado de contenido]({{site}}/docs/guides/content-modeling/) explica dónde se definen los campos de las colecciones.

| Campo | Tipo | Comportamiento |
| --- | --- | --- |
| `seo.title` | Texto | Sustituye el título de la página en los metadatos para buscadores y redes sociales. |
| `seo.description` | Área de texto | Proporciona la descripción utilizada en las vistas previas de buscadores y redes sociales. |
| `seo.canonicalPath` | Texto | Sustituye la URL canónica por una ruta relativa a la raíz. |
| `seo.ogImage` | Texto | Proporciona una URL de imagen relativa a la raíz o absoluta para las vistas previas en redes sociales. |
| `seo.noIndex` | Casilla de verificación | Solicita a los motores de búsqueda que no indexen la página ni sigan sus enlaces. |

Procura que los títulos sean descriptivos y diferenciados. Un título de entre 50 y 60 caracteres y una descripción de entre 150 y 160 caracteres son referencias útiles para la edición, no límites de visualización garantizados. Los motores de búsqueda pueden elegir otro texto o truncarlo.

Para `canonicalPath`, introduce una ruta como `/services/`, no una URL completa. Déjalo vacío cuando la página actual sea la versión canónica. Para `ogImage`, usa la URL de una imagen publicada a la que los rastreadores de redes sociales puedan acceder sin iniciar sesión.

> **Nota:** El campo `noIndex` controla una directiva para robots; no hace que una página sea privada. Usa controles de acceso para el contenido que no deba estar disponible públicamente.

## Generar metadatos para cada página

En `src/app/[[...slug]]/page.tsx`, obtén la página a partir de los segmentos de la ruta y devuelve sus metadatos. La función auxiliar `getPageBySlug` del starter, ubicada en `src/lib/getPageBySlug.ts`, acepta un slug separado por barras y una opción de borrador; un slug vacío devuelve la página de inicio.

```tsx
import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'
import { starterConfig } from '@/../starter.config'
import { getPageBySlug } from '@/lib/getPageBySlug'

type Props = {
  params: Promise<{ slug?: string[] }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug = [] } = await params
  const { isEnabled } = await draftMode()
  const page = await getPageBySlug(slug.join('/'), { draft: isEnabled })

  if (!page) notFound()

  const currentPath = slug.length ? `/${slug.join('/')}/` : '/'
  const requestedPath = page.seo?.canonicalPath
  const canonicalPath =
    requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
      ? requestedPath
      : currentPath
  const title = page.seo?.title || page.title || starterConfig.seo.defaultTitle
  const description =
    page.seo?.description || starterConfig.seo.defaultDescription
  const image = page.seo?.ogImage || starterConfig.seo.defaultOgImage
  const noIndex = isEnabled || page.seo?.noIndex === true

  return {
    metadataBase: new URL(starterConfig.seo.siteUrl),
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: { title, description, images: [image] },
    robots: { index: !noIndex, follow: !noIndex },
  }
}
```

El componente de página de la ruta puede usar la misma función auxiliar para cargar y renderizar sus bloques. Asegúrate de que el comportamiento de la función con los borradores sea coherente tanto para la renderización como para los metadatos: las solicitudes de vista previa deben leer contenido en borrador y las solicitudes normales deben leer únicamente contenido publicado.

`metadataBase` resuelve las rutas relativas de las URL canónicas y las imágenes con respecto a `SITE_URL`. La comprobación de la ruta canónica recurre a la ruta actual si el editor introduce un valor que no es relativo a la raíz. No comprueba si el destino existe, por lo que debes revisar las URL canónicas personalizadas antes de publicar.

## Publicar y verificar

Sigue estos pasos para una página nueva o un cambio en los metadatos:

1. Introduce un título para la página y, cuando sea necesario, completa los campos SEO en Payload.
2. Previsualiza la página y confirma que el título, la descripción y la imagen coincidan con el contenido.
3. Publica la página y, después, inspecciona la respuesta pública. Si la publicación está programada, sigue la [guía de publicación programada]({{site}}/docs/recipes/scheduled-publishing/) y comprueba el resultado después de la hora prevista.
4. Confirma que la URL canónica use el origen de producción previsto y que la imagen para redes sociales sea accesible públicamente.

Con `SITE_URL` configurado para el entorno que quieres inspeccionar, solicita una página publicada y busca sus metadatos en el HTML:

```bash
curl -sL "$SITE_URL/services/" | grep -Eo '<(title|meta|link)[^>]*>'
```

Comprueba en el resultado el `title`, la descripción, la imagen Open Graph, el enlace canónico y la directiva para robots. Este comando inspecciona la respuesta del servidor, no una vista previa en el navegador. Si los metadatos no están actualizados después de publicar, revisa la caché de obtención de páginas y el comportamiento de revalidación antes de cambiar los campos en el editor.
