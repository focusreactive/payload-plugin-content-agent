title: Modelado de contenido

El modelado de contenido en {{short}} Starter define qué pueden introducir los editores y cómo se convierte ese contenido en una página. El starter combina las colecciones de [Payload](https://payloadcms.com) con el App Router de [Next.js](https://nextjs.org): una página almacena campos estructurados y una lista ordenada de bloques, mientras que los componentes de React renderizan esos bloques. Usa campos de colección para la información que comparten todas las páginas y bloques para las secciones que los editores pueden agregar, eliminar y reordenar.

## Elegir campos y bloques

La colección Pages es el punto de partida para el contenido de las páginas. Su campo `layout` es un campo de bloques de Payload, por lo que cada elemento de la lista tiene un tipo de bloque y los campos definidos para ese tipo. Mantén en la colección los campos como el título y el slug de la página; coloca en un bloque el contenido que corresponda a una sección repetible.

Antes de agregar un bloque, decide qué necesitan controlar los editores. Un bloque destacado podría necesitar un encabezado, un texto breve y un tono visual. No necesita campos separados para cada clase CSS: esos son detalles de presentación que pertenecen al componente.

El starter almacena las definiciones de los bloques y sus componentes en `src/blocks/`. La configuración de la colección se encuentra en `src/collections/Pages.ts`. La configuración del generador en `starter.config.ts` es independiente del esquema de Payload; modificar solo ese archivo no agrega un campo a una colección existente.

## Definir un bloque

Crea `src/blocks/Callout/config.ts` con una definición de bloque de Payload:

```ts
import type { Block } from 'payload'

export const Callout: Block = {
  slug: 'callout',
  interfaceName: 'CalloutBlock',
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
    {
      name: 'body',
      type: 'textarea',
      required: true,
    },
    {
      name: 'tone',
      type: 'select',
      required: true,
      defaultValue: 'neutral',
      options: [
        { label: 'Neutral', value: 'neutral' },
        { label: 'Information', value: 'info' },
        { label: 'Warning', value: 'warning' },
      ],
    },
  ],
}
```

Estos campos controlan tanto el formulario de edición como los datos almacenados del bloque:

| Campo | Propósito | Comportamiento |
| --- | --- | --- |
| `heading` | Título breve del bloque destacado | Texto obligatorio |
| `body` | Mensaje complementario | Texto multilínea obligatorio |
| `tone` | Opción de presentación | Selección obligatoria, con `neutral` como valor predeterminado |
| `blockType` | Identifica el bloque al renderizarlo | Payload lo proporciona a partir del slug del bloque |

Elige el slug con cuidado. Payload lo almacena como `blockType`, por lo que cambiar `callout` más adelante también exige actualizar el contenido existente o gestionar el valor anterior durante una transición.

## Registrar y renderizar el bloque

Agrega la definición a la colección Pages y luego conéctala a un componente. Sigue estos pasos:

1. Importa `Callout` desde `src/blocks/Callout/config.ts` en `src/collections/Pages.ts`.
2. Agrega `Callout` al arreglo `blocks` del campo `layout`, conservando las definiciones de bloques existentes en ese arreglo.
3. Regenera los tipos de Payload para incluir el nuevo bloque en `src/payload-types.ts`.
4. Crea el componente que aparece a continuación en `src/blocks/Callout/Component.tsx`.
5. Agrega un caso `callout` a `src/blocks/RenderBlocks.tsx` que renderice `CalloutComponent` con los campos almacenados del bloque.

```tsx
import type { CalloutBlock } from '@/payload-types'

export function CalloutComponent({
  heading,
  body,
  tone,
}: CalloutBlock) {
  return (
    <aside className="callout" data-tone={tone}>
      <h2>{heading}</h2>
      <p>{body}</p>
    </aside>
  )
}
```

El renderizador debe seleccionar los componentes mediante `blockType`, no por la posición del bloque en el diseño. Conserva los casos existentes al agregar el nuevo. Agrega estilos para los valores de `data-tone` en las hojas de estilo de la aplicación; el esquema ofrece la opción, pero no define su apariencia visual.

Desde la raíz del proyecto, regenera los tipos e inicia el servidor de desarrollo:

```bash
npm run generate:types
npm run dev
```

En el panel de administración de Payload, abre una página, agrega un bloque Callout y guárdala. Revisa tanto la página renderizada como el formulario de edición: un bloque registrado solo en Payload puede guardarse sin aparecer en el sitio si falta su caso en el renderizador.

## Modificar el contenido de forma segura

Considera los cambios en el esquema como cambios en el contenido almacenado, no solo en el formulario. Agregar un campo opcional suele ser menos disruptivo que hacer obligatorio un campo nuevo en bloques que los editores ya han guardado. Un valor predeterminado ayuda con las entradas nuevas, pero no des por hecho que se haya aplicado a todos los documentos existentes.

Antes de eliminar o cambiar el nombre de un campo, identifica el contenido que lo utiliza y planifica una migración de datos. Actualiza el renderizador y los tipos generados junto con el esquema y, después, prueba páginas que contengan tanto contenido antiguo como nuevo. Conserva la lógica de renderizado anterior hasta que se hayan migrado los datos almacenados.

> **Nota:** Regenerar los tipos de TypeScript actualiza la representación del esquema en el código, pero no migra el contenido existente en la base de datos.

## Preparar el despliegue

Una vez que el bloque funcione en el entorno local, incluye su esquema, componente, cambio en el renderizador y tipos generados en un mismo commit. Prueba una página con más de un bloque y reordénalos para confirmar que el orden mostrado coincide con el definido por el editor.

Cuando el esquema esté listo para el entorno de destino, sigue la guía para [desplegar el starter]({{site}}/docs/getting-started/first-deploy/). Para consultar los comandos y las opciones del generador, revisa las [opciones de la CLI]({{site}}/docs/reference/cli/). Si una página necesita acceso restringido, utiliza la guía para [agregar protección con contraseña]({{site}}/docs/recipes/protect-a-page/) en lugar de confiar en una URL no publicada o difícil de encontrar como medida de control de acceso.
