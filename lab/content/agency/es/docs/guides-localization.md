title: Localización

{{short}} Starter utiliza rutas con prefijos de idioma para ofrecer contenido en varios idiomas desde un mismo proyecto. [Payload](https://payloadcms.com) almacena el contenido localizado y el App Router de [Next.js](https://nextjs.org) selecciona el idioma a partir de la URL. Esta guía configura páginas en inglés y francés, con el inglés como idioma alternativo cuando un campo de bloque localizado no tiene ningún valor.

## Configurar los idiomas

Crea un proyecto con la CLI del starter y abre `starter.config.ts` en la raíz del proyecto. El starter utiliza este archivo para configurar la localización de Payload y sus funciones auxiliares de enrutamiento por idioma.

```bash
npx create-headless-starter my-site
cd my-site
npm run generate:types
npm run dev
```

Sustituye la configuración de localización en `starter.config.ts` por:

```ts
import { defineStarterConfig } from './src/starter/config'

export default defineStarterConfig({
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'French' },
    ],
    defaultLocale: 'en',
    fallback: true,
  },
})
```

Ejecuta `npm run generate:types` de nuevo después de cambiar la lista de idiomas. El comando vuelve a generar los tipos de Payload que utilizan las funciones auxiliares de enrutamiento y las consultas de contenido. Reinicia el servidor de desarrollo para que aplique la nueva configuración.

El starter aplica estos ajustes al generar la configuración de Payload. Mantén estables los códigos de idioma una vez que los editores hayan comenzado a introducir contenido: cambiar un código no migra los valores localizados existentes.

| Opción | Función | Ejemplo |
| --- | --- | --- |
| `locales` | Idiomas disponibles en el panel de administración y en el sitio | `en` y `fr` |
| `code` | Identificador de idioma utilizado en las URL y las consultas | `fr` |
| `label` | Nombre que ven los editores en el panel de administración | `French` |
| `defaultLocale` | Idioma predeterminado para las operaciones de contenido | `en` |
| `fallback` | Permite recurrir al idioma predeterminado cuando faltan valores localizados | `true` |

## Cómo se localizan las páginas y los bloques

La colección `pages` del starter tiene un campo `path` compartido y un campo `layout` localizado. La ruta identifica la misma página en todos los idiomas; el diseño contiene los bloques de la página. Por ejemplo, tanto `/en/about` como `/fr/about` consultan la página cuya ruta es `/about`.

Como `layout` está localizado, los editores gestionan una lista de bloques independiente para cada idioma. Pueden cambiar el orden de los bloques, añadirlos o eliminarlos en francés sin modificar el diseño en inglés. Las definiciones de los bloques se encuentran en `src/blocks/`; sus campos forman parte del diseño localizado y no necesitan ajustes de localización individuales.

Este enfoque también implica que las traducciones no se sincronizan automáticamente cuando cambia el diseño original. Revisa los demás idiomas después de añadir un bloque a una página existente. La guía sobre la [estructura de directorios]({{site}}/docs/getting-started/project-structure/) explica dónde se encuentran la colección y los componentes que renderizan los bloques.

> **Nota:** El mecanismo alternativo proporciona el diseño en inglés cuando el diseño solicitado en otro idioma no tiene ningún valor. No traduce el texto ni combina bloques individuales de ambos diseños.

## Enrutar las solicitudes según el idioma

El starter sitúa la ruta de página en `src/app/(frontend)/[locale]/[[...slug]]/page.tsx`. El segmento opcional que captura todas las rutas gestiona tanto la página de inicio de cada idioma como las rutas anidadas. Una función auxiliar de idioma valida la URL antes de ejecutar la consulta.

La ruta sigue este patrón:

```tsx
import config from '@payload-config'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import { RenderBlocks } from '@/blocks/RenderBlocks'
import { isStarterLocale } from '@/starter/locales'

type Props = {
  params: Promise<{ locale: string; slug?: string[] }>
}

export default async function Page({ params }: Props) {
  const { locale, slug } = await params

  if (!isStarterLocale(locale)) notFound()

  const path = slug?.length ? `/${slug.join('/')}` : '/'
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'pages',
    where: { path: { equals: path } },
    locale,
    fallbackLocale: 'en',
    draft: false,
    limit: 1,
  })

  const page = result.docs[0]
  if (!page) notFound()

  return <RenderBlocks blocks={page.layout ?? []} />
}
```

La declaración explícita de `fallbackLocale` deja claro qué idioma alternativo utiliza la consulta. Si cambias el idioma predeterminado, actualiza también este valor. Un idioma no admitido o una ruta de página desconocida devuelve un error 404. Si la ruta existe pero falta el diseño en francés, se puede renderizar el diseño en inglés como alternativa.

## Añadir y comprobar una traducción

1. En el panel de administración de Payload, crea una página con la ruta `/about`. Añade y publica su diseño en inglés.
2. Cambia el idioma del panel de administración a francés. Añade los bloques en francés y guarda la página.
3. Publica la página después de revisar el diseño traducido. Guardar un borrador no basta para que esté disponible en la consulta pública anterior.
4. Visita `/en/about` y `/fr/about`. Revisa el texto, el orden de los bloques, los enlaces y los archivos multimedia específicos de cada idioma.
5. Prueba una página sin diseño en francés para confirmar que el uso del inglés como alternativa es aceptable.

La ruta compartida debe comenzar con `/` y no debe incluir un prefijo de idioma. Usa `/` para la página de inicio. Este starter no traduce los segmentos de las rutas, así que elige rutas que funcionen para todos los idiomas configurados.

Si un bloque muestra una imagen con texto integrado, proporciona una imagen adecuada para cada diseño localizado. La guía sobre la [preparación y entrega de imágenes]({{site}}/docs/guides/image-handling/) explica el flujo de trabajo del starter para archivos multimedia.

## Comprobaciones de publicación e idioma alternativo

El uso de un idioma alternativo es útil mientras se traduce un sitio, pero puede hacer que una traducción incompleta parezca una página terminada. Antes del lanzamiento, revisa todas las rutas disponibles en cada idioma y confirma qué páginas utilizan intencionadamente el idioma alternativo.

Mantén las comprobaciones de publicación específicas de cada idioma en la colección de páginas, en lugar de incluirlas en los componentes de renderizado individuales. Por ejemplo, un hook de validación puede avisar a los editores cuando falta el diseño de un idioma obligatorio. Consulta [cómo se ejecutan los hooks]({{site}}/docs/reference/hooks/) antes de añadir esa comprobación, especialmente si debe comportarse de forma diferente para borradores y páginas publicadas.
