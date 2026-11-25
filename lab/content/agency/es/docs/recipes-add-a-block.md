title: Añadir un bloque

{{short}} Starter combina el App Router de [Next.js](https://nextjs.org) con [Payload CMS](https://payloadcms.com), TypeScript y una biblioteca de bloques de página. En esta guía añadirás un bloque de introducción de funcionalidades: los editores introducirán un texto introductorio opcional y un título obligatorio, y el renderizador de la página los mostrará. Definirás los campos de Payload, crearás un componente de React y registrarás ambos en `starter.config.ts`.

## Planifica el bloque

Los bloques se almacenan como elementos en el campo `layout` de una página. Cada elemento tiene un `blockType` que identifica su esquema y su renderizador. Asigna al nuevo bloque un slug único y mantenlo estable una vez que los editores empiecen a usarlo.

1. Crea una carpeta para el bloque dentro de `src/blocks/`.
2. Define sus campos en un esquema de bloque de Payload.
3. Crea un componente que acepte los valores guardados de los campos.
4. Añade el esquema y el componente a la configuración del starter.
5. Crea una página en el panel de administración, añade el bloque y comprueba el resultado renderizado.

Si no conoces los directorios del starter, consulta [cómo está organizado el proyecto]({{site}}/docs/getting-started/project-structure/) antes de hacer cambios.

## Define los campos

Crea `src/blocks/FeatureIntro/schema.ts`:

```ts
import type { Block } from 'payload'

export const FeatureIntroBlock: Block = {
  slug: 'featureIntro',
  labels: {
    singular: 'Feature intro',
    plural: 'Feature intros',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
    },
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
  ],
}
```

Payload usa el esquema para crear el formulario de edición y validar el contenido guardado. Las siguientes propiedades determinan cómo se identifica y edita este bloque:

| Propiedad | Función | Valor en esta guía |
| --- | --- | --- |
| `slug` | Identifica el bloque en los datos almacenados de la página | `featureIntro` |
| `labels` | Define los nombres del bloque en la interfaz de administración | Feature intro y Feature intros |
| `eyebrow` | Proporciona un texto opcional encima del título | Un campo de texto |
| `heading` | Proporciona el título principal visible | Un campo de texto obligatorio |
| `blockType` | Registra qué esquema de bloque usa un elemento | Payload lo establece a partir del slug |

`blockType` no es un campo que debas añadir al esquema. Payload lo incluye en cada elemento de bloque guardado para que el starter pueda seleccionar el renderizador correspondiente.

Para obtener más información sobre las convenciones de bloques del starter, consulta [la referencia de campos y renderizado]({{site}}/docs/reference/blocks/).

## Crea el renderizador

Crea `src/blocks/FeatureIntro/Component.tsx`:

```tsx
type FeatureIntroProps = {
  eyebrow?: string | null
  heading: string
}

export function FeatureIntro({ eyebrow, heading }: FeatureIntroProps) {
  return (
    <section>
      {eyebrow && <p>{eyebrow}</p>}
      <h2>{heading}</h2>
    </section>
  )
}
```

El componente recibe los campos guardados como props. El texto introductorio opcional puede estar ausente o ser `null`, por lo que solo se renderiza cuando tiene un valor. El título es obligatorio según el esquema y se renderiza como un `h2`.

Usa un `h2` aquí porque la plantilla de página del starter proporciona el `h1` de la página. Si el diseño de tu página necesita una jerarquía de títulos diferente, modifica el componente para adaptarlo al contenido circundante. React renderiza estos valores como texto, en lugar de interpretar como HTML lo que introducen los editores.

## Registra el bloque

Añade el bloque a `starter.config.ts` en la raíz del proyecto. Conserva las entradas integradas en el array para que las páginas existentes puedan seguir renderizándolas:

```ts
import { defineStarterConfig } from '@/starter/defineStarterConfig'
import { builtInBlocks } from '@/blocks/registry'
import { FeatureIntroBlock } from '@/blocks/FeatureIntro/schema'
import { FeatureIntro } from '@/blocks/FeatureIntro/Component'

export default defineStarterConfig({
  blocks: [
    ...builtInBlocks,
    {
      slug: 'featureIntro',
      schema: FeatureIntroBlock,
      Component: FeatureIntro,
    },
  ],
})
```

El starter lee esta lista al crear el campo de bloques de la colección Pages y al seleccionar un componente para renderizar cada elemento guardado. El slug del registro debe coincidir con el slug del esquema y con el `blockType` guardado. Si no coinciden, es posible que un bloque esté disponible en el editor, pero no tenga un renderizador correspondiente.

Reinicia el servidor de desarrollo después de cambiar la configuración. Así te aseguras de que tanto el formulario de administración como el renderizador de páginas carguen el registro actualizado.

> **Nota:** Cambiar o eliminar un slug después de guardar páginas no modifica sus valores de `blockType` existentes. Planifica una migración de contenido antes de cambiar un slug en un sitio con páginas publicadas.

## Comprueba el resultado

En el panel de administración de Payload, abre una página y añade **Feature intro** a su diseño. Introduce «Explora la colección» como título, deja vacío el texto introductorio y guarda. Abre la página y comprueba que el título aparece sin un párrafo vacío encima. Después, añade un texto introductorio, vuelve a guardar y comprueba que aparecen ambos valores.

Comprueba también una página existente que use un bloque integrado. Así podrás detectar si las entradas de `builtInBlocks` se eliminaron accidentalmente durante el registro. Si el nuevo bloque no aparece en el editor, revisa la importación del esquema y reinicia el servidor. Si aparece en el editor pero no en la página, comprueba que el slug del registro coincida con `featureIntro`.

Los campos de este ejemplo se comparten entre todos los idiomas. Si cada idioma necesita su propio texto, habilita la localización de los campos correspondientes y sigue [la guía de configuración de localización]({{site}}/docs/guides/localization/) antes de introducir contenido traducido.
