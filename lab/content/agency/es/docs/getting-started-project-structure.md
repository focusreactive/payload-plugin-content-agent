title: Estructura del proyecto

{{short}} Starter separa el sitio público, el panel de administración de Payload y los modelos de contenido que los conectan. Utiliza el App Router de [Next.js](https://nextjs.org) para las rutas y [Payload](https://payloadcms.com) para la gestión de contenidos. La siguiente estructura es la que obtienes al crear un proyecto con `npx create-headless-starter`; después puedes modificar el proyecto generado de forma independiente de la plantilla inicial.

## Estructura principal

El código de la aplicación se encuentra en `src/`, mientras que los archivos de configuración y de paquetes permanecen en la raíz. Las rutas más importantes son:

```bash
# starter.config.ts
# next.config.ts
# package.json
# src/
#   app/
#     (frontend)/
#       page.tsx
#       [slug]/page.tsx
#     (payload)/
#       admin/[[...segments]]/page.tsx
#       api/[...slug]/route.ts
#   blocks/
#     Hero/
#       config.ts
#       Component.tsx
#     RichText/
#       config.ts
#       Component.tsx
#   collections/
#     Pages.ts
#   components/
#     RenderBlocks.tsx
#   payload.config.ts
#   payload-types.ts
```

Los directorios `(frontend)` y `(payload)` son grupos de rutas: sus nombres organizan el código sin formar parte de la URL. El grupo del frontend contiene la página de inicio y las rutas de páginas de un solo segmento. El grupo de Payload contiene las rutas del panel de administración y de la API, que deben seguir disponibles cuando agregues rutas al frontend.

`src/payload.config.ts` registra las colecciones y otras opciones de configuración de Payload. `src/payload-types.ts` se genera a partir de esa configuración; vuelve a generarlo después de cambiar una colección o un bloque, en lugar de editarlo manualmente.

## Configura el proyecto

`starter.config.ts` contiene los valores predeterminados que comparte el frontend. Su estructura inicial es:

```ts
export const starterConfig = {
  siteName: '{{short}} Starter',
  siteUrl: process.env.SITE_URL,
  defaultLocale: 'en',
  trailingSlash: false,
}
```

La plantilla importa estos valores en sus funciones auxiliares de metadatos, en la renderización de páginas y en la configuración de Next.js. No sustituyen la configuración de `src/payload.config.ts`.

| Campo | Función |
| --- | --- |
| `siteName` | Nombre predeterminado del sitio que usan las funciones auxiliares de metadatos. |
| `siteUrl` | Origen público utilizado para crear URL absolutas en los metadatos. Configúralo mediante `SITE_URL` en los entornos desplegados. |
| `defaultLocale` | Idioma predeterminado del contenido generado por el frontend. Esto no activa la localización de Payload. |
| `trailingSlash` | Controla la configuración correspondiente de enrutamiento de Next.js. |

Establece `SITE_URL` con el origen público de cada entorno. La [guía de metadatos]({{site}}/docs/guides/seo-metadata/) explica cómo lo utiliza el frontend para las URL canónicas y otros metadatos. Antes de publicar el sitio, sigue los [pasos de despliegue]({{site}}/docs/getting-started/first-deploy/) para configurar las variables de entorno y compilar la aplicación.

> **Nota:** `starter.config.ts` es código de la aplicación, no contenido de Payload. Cambiar un valor requiere volver a compilar o reiniciar la aplicación; los editores no pueden modificarlo desde el panel de administración.

## Sigue el recorrido de una solicitud de página

La ruta de inicio en `src/app/(frontend)/page.tsx` carga el registro de la página de inicio. La ruta `[slug]` carga una página publicada que coincide con el slug solicitado. Ambas rutas pasan la estructura de la página a `RenderBlocks`, que selecciona un componente de React para cada bloque guardado.

El esquema de la página se define en `src/collections/Pages.ts`. Su campo `layout` registra las configuraciones de bloques disponibles. El archivo `config.ts` de cada bloque define lo que pueden introducir los editores, mientras que `Component.tsx` define cómo aparecen esos datos en el sitio.

Payload también expone los datos de las colecciones a través de sus rutas de API. Consulta la [documentación de la API]({{site}}/docs/reference/rest-api/) cuando consumas esos datos fuera del frontend y revisa las reglas de acceso de la colección antes de asumir que un registro es público.

## Renderiza la biblioteca de bloques

`src/components/RenderBlocks.tsx` es el puente entre una estructura guardada y los componentes de React. El tipo `Page` generado mantiene el renderizador alineado con los esquemas de bloques registrados:

```tsx
import type { Page } from '@/payload-types'
import { Hero } from '@/blocks/Hero/Component'
import { RichText } from '@/blocks/RichText/Component'

type Block = NonNullable<Page['layout']>[number]

export function RenderBlocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((block, index) => {
    const key = block.id ?? index

    switch (block.blockType) {
      case 'hero':
        return <Hero key={key} {...block} />
      case 'richText':
        return <RichText key={key} {...block} />
      default:
        return null
    }
  })
}
```

Los valores de `blockType` deben coincidir con los slugs de las configuraciones de bloques. El caso predeterminado no devuelve nada para un bloque que no se haya contemplado, por lo que debes registrar un renderizador cada vez que agregues un esquema. Cuando Payload proporciona identificadores de bloque estables, estos se utilizan como claves de React.

## Agrega un bloque

Mantén juntos los campos de edición y el componente de frontend de cada bloque en `src/blocks/`. Para agregar un bloque:

1. Crea un directorio dentro de `src/blocks/` con un archivo `config.ts` que defina un bloque de Payload y un archivo `Component.tsx` que renderice sus campos.
2. Importa la configuración del bloque en `src/collections/Pages.ts` y agrégala a la lista de bloques del campo `layout`. Asígnale un slug único.
3. Ejecuta `npx payload generate:types` para actualizar `src/payload-types.ts` a partir del esquema registrado.
4. Importa el componente en `RenderBlocks.tsx` y agrega un caso para el slug del nuevo bloque.
5. Inicia el proyecto con `npm run dev`, agrega el bloque a una página desde el panel de administración y comprueba la página publicada en el frontend.

Incluye en un mismo commit el esquema, el componente, el cambio en el renderizador y los tipos regenerados. Así, las opciones de edición y la renderización del frontend se mantendrán sincronizadas cuando otro desarrollador descargue el proyecto.
