title: Referencia de bloques

Los bloques definen las secciones que los editores pueden añadir a una página en {{short}} Starter. Cada bloque tiene un esquema de Payload y un componente de React: el esquema controla el formulario de edición, mientras que el componente controla cómo se muestra el contenido. Los bloques se encuentran en `src/blocks/` y se almacenan en el orden en que los editores los organizan en el campo `layout` de la página.

## Cómo se relacionan los bloques

El proyecto inicial registra sus bloques de página en la colección Pages y los renderiza mediante un componente compartido, `RenderBlocks`. Payload almacena cada entrada con un identificador `blockType`, que el renderizador utiliza para seleccionar el componente de React correspondiente.

La estructura inicial incluye los bloques Hero y Rich Text. El archivo `starter.config.ts` del proyecto guarda la configuración inicial, pero modificarlo no registra automáticamente un bloque nuevo en una colección Pages existente. Actualiza el esquema de Payload y el renderizador al mismo tiempo.

[Payload](https://payloadcms.com) gestiona los campos del bloque y la interfaz de edición. El App Router de [Next.js](https://nextjs.org) renderiza la página resultante. Un bloque es contenido dentro de una página, no una ruta independiente.

## Campos de Hero

El bloque Hero está pensado para introducir el contenido en la parte superior de una página, aunque los editores pueden colocarlo en otro lugar. Su esquema se encuentra en `src/blocks/Hero/config.ts`:

```ts
import type { Block } from 'payload'

export const Hero: Block = {
  slug: 'hero',
  fields: [
    { name: 'eyebrow', type: 'text' },
    { name: 'heading', type: 'text', required: true },
    { name: 'body', type: 'textarea' },
    {
      name: 'cta',
      type: 'group',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'href', type: 'text', required: true },
      ],
    },
  ],
}
```

| Campo | Tipo | Obligatorio | Función |
| --- | --- | --- | --- |
| `eyebrow` | text | No | Texto breve que aparece encima del encabezado |
| `heading` | text | Sí | Encabezado principal de la sección |
| `body` | textarea | No | Texto complementario debajo del encabezado |
| `cta.label` | text | Dentro del grupo CTA | Texto que aparece en el enlace |
| `cta.href` | text | Dentro del grupo CTA | Destino del enlace |

El componente Hero solo muestra la llamada a la acción cuando están presentes tanto el texto del enlace como su destino. Asegúrate de que los destinos de los enlaces sigan las convenciones de rutas de tu sitio. El esquema anterior acepta texto; añade validación si tu proyecto necesita restringir los destinos.

> **Nota:** Un encabezado obligatorio garantiza que el campo esté presente en el contenido guardado, pero no que la página tenga exactamente un encabezado de nivel superior. Define convenciones para los niveles de encabezado en todos los componentes de bloques.

## Registrar bloques en Payload

La colección Pages determina qué bloques pueden insertar los editores. Este ejemplo registra el bloque Hero y el bloque Rich Text del proyecto inicial en `src/collections/Pages.ts`:

```ts
import type { CollectionConfig } from 'payload'
import { Hero } from '../blocks/Hero/config'
import { RichText } from '../blocks/RichText/config'

export const Pages: CollectionConfig = {
  slug: 'pages',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true },
    {
      name: 'layout',
      type: 'blocks',
      blocks: [Hero, RichText],
    },
  ],
}
```

El `slug` de cada bloque debe ser único dentro del campo `layout`. Payload guarda ese slug como `blockType`; si lo cambias después de crear contenido, tendrás que migrar los datos además de modificar el código.

La colección que se muestra aquí es intencionalmente sencilla. Tu proyecto puede añadir opciones para borradores, reglas de acceso y otros campos de página sin cambiar la forma de registrar los bloques. Si estás [migrando un proyecto existente de la versión 2 a la versión 3]({{site}}/docs/guides/upgrading-to-3/), revisa los pasos de migración antes de cambiar los tipos de bloque almacenados.

## Renderizar el diseño

El renderizador del proyecto inicial asigna cada tipo de bloque registrado a un componente. Este ejemplo utiliza el tipo generado `Page` y los componentes de bloques en `src/blocks/`:

```tsx
import type { Page } from '../payload-types'
import { HeroBlock } from '../blocks/Hero/Component'
import { RichTextBlock } from '../blocks/RichText/Component'

export function RenderBlocks({ layout }: { layout: Page['layout'] }) {
  return (
    <>
      {layout?.map((block, index) => {
        const key = block.id ?? index

        switch (block.blockType) {
          case 'hero':
            return <HeroBlock key={key} {...block} />
          case 'richText':
            return <RichTextBlock key={key} {...block} />
          default:
            return null
        }
      })}
    </>
  )
}
```

Pasa el campo `layout` de la página obtenida a `RenderBlocks` desde la ruta de la página. El mapeo opcional permite gestionar páginas sin entradas de diseño. La opción predeterminada no devuelve nada para los tipos no reconocidos, así que comprueba tanto el registro como la renderización si un bloque aparece en el editor, pero no en el sitio.

El ID generado del bloque proporciona una clave estable para React cuando está disponible. El índice del array se utiliza como alternativa para las entradas sin ID.

## Añadir y probar un bloque

1. Crea un directorio en `src/blocks/` con una configuración de bloque de Payload y un componente de React. Asigna al bloque un slug único y define todos los campos que necesita el componente.
2. Importa la configuración en la colección Pages y añádela al array `blocks` del campo `layout`.
3. Añade un caso correspondiente en `RenderBlocks` y ejecuta `npx payload generate:types` para actualizar las definiciones de TypeScript.
4. Sigue el proceso de migración de la base de datos de tu proyecto si el cambio de esquema lo requiere. Si el proyecto utiliza las migraciones de Payload, crea y revisa una migración con `npx payload migrate:create` antes de aplicarla.
5. Añade el bloque a una página de prueba, guárdala y comprueba tanto el editor como la ruta renderizada. Prueba los campos opcionales tanto vacíos como con contenido.

Los componentes de bloques deben renderizar los datos que reciben, sin eludir las reglas de acceso de la página. Para el contenido restringido, sigue la guía para [proteger una página con contraseña]({{site}}/docs/recipes/protect-a-page/). Para revisar los cambios de edición antes de publicar, configura las [actualizaciones de vista previa para editores]({{site}}/docs/guides/live-preview/) y prueba también el nuevo bloque allí.
