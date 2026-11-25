title: Referencia de hooks

Los hooks permiten ejecutar código del lado del servidor durante la resolución de bloques en un proyecto Starter de {{short}}. Puedes usarlos, por ejemplo, para registrar qué bloques se resuelven en una solicitud, o utilizar los hooks de colección de Payload para responder a cambios en el contenido. Los hooks de Starter y los de Payload son independientes: los primeros se ejecutan cuando se solicita una página, mientras que los segundos se ejecutan durante las operaciones del CMS.

## Ubicación de los hooks

Configura los hooks de Starter en `starter.config.ts`. El renderizador de páginas generado lee ese archivo y llama a los hooks a medida que resuelve los bloques de `src/blocks/`. Cada hook recibe el bloque actual y el contexto de la solicitud; ninguno requiere cambios en los componentes individuales de los bloques.

Los hooks de colección de Payload se definen en la configuración de la colección de Payload. No se ejecutan a través de la configuración de hooks de Starter. Para consultar las API del CMS, visita la [documentación de Payload](https://payloadcms.com); para las API de renderizado en el servidor y de caché que utiliza el starter, consulta la [documentación de Next.js](https://nextjs.org).

Los hooks de Starter se ejecutan en el servidor, incluso para las vistas previas de borradores. No vuelven a ejecutarse cuando un componente de cliente se actualiza en el navegador. Evita usarlos para analítica del navegador o para tareas que dependan de que un componente se haya montado.

## Campos de los hooks de Starter

La función auxiliar generada `defineStarterConfig` proporciona los tipos para la configuración y los argumentos de los hooks. Todos los hooks son opcionales.

| Campo | Tipo | Propósito |
| --- | --- | --- |
| `hooks.beforeBlockResolve` | Función | Recibe un bloque antes de buscar su componente y devuelve el bloque que se resolverá. |
| `hooks.afterBlockResolve` | Función | Se ejecuta después de que el componente del bloque haya devuelto un elemento. Su valor de retorno se ignora. |
| `block.blockType` | Cadena | Identifica el componente de bloque registrado. |
| `context.pathname` | Cadena | Contiene la ruta solicitada sin la cadena de consulta. |
| `context.preview` | Booleano | Indica si la solicitud usa la vista previa de borradores. |

Ambos hooks pueden ser asíncronos. `beforeBlockResolve` debe devolver un bloque, aunque no realice cambios. Conserva `blockType` y los campos obligatorios del esquema de ese bloque; el resolvedor utiliza `blockType` para seleccionar un componente y no valida la salida del hook. `afterBlockResolve` recibe el bloque devuelto por el hook anterior y el mismo contexto.

El hook posterior indica que el componente ha devuelto un elemento, no que la respuesta haya terminado de transmitirse ni que un navegador la haya mostrado. Si un hook lanza una excepción, la resolución se detiene y el error se propaga al mecanismo de gestión de errores de la ruta. El starter no reintenta la ejecución de los hooks.

## Configurar un hook

Este ejemplo registra cada bloque resuelto sin cambiar su contenido. La importación de la función auxiliar es relativa al archivo de configuración situado en la raíz del proyecto.

```ts
import { defineStarterConfig } from './src/starter/define-config'

export default defineStarterConfig({
  hooks: {
    beforeBlockResolve: async ({ block, context }) => {
      if (context.preview) {
        console.info('Resolving preview block', block.blockType)
      }

      return block
    },
    afterBlockResolve: async ({ block, context }) => {
      console.info('Resolved block', block.blockType, context.pathname)
    },
  },
})
```

Los hooks se ejecutan una vez por bloque, en el orden de la página. Para cada bloque, el hook previo termina antes de buscar el componente y el hook posterior solo se ejecuta si el componente se resuelve correctamente. Procura que las tareas de cada bloque sean ligeras: una llamada de red lenta en cualquiera de los hooks añade latencia al renderizado de la página.

> **Nota:** El contexto de un hook es específico de cada solicitud. No lo almacenes en una variable de nivel de módulo ni lo uses para compartir estado entre solicitudes.

Para probar la configuración en un proyecto nuevo:

1. Crea un proyecto con la CLI del starter:

   ```bash
   npx create-headless-starter my-project
   cd my-project
   ```

2. Configura las variables de entorno descritas en el archivo `.env.example` del proyecto generado; después, instala las dependencias e inicia el servidor de desarrollo con los comandos de su README.
3. Añade la configuración anterior, solicita una página que contenga bloques y revisa los registros del servidor. Abre la página en vista previa para ver el mensaje adicional del hook previo.
4. Añade o modifica un bloque siguiendo la [guía para crear bloques]({{site}}/docs/recipes/add-a-block/). Registrar un bloque lo pone a disposición del resolvedor; los hooks no registran componentes.

## Revalidar tras cambios en el contenido

Un hook `afterChange` de Payload es un lugar adecuado para invalidar una ruta renderizada cuando un editor guarda una página. En el starter generado, añade la siguiente función al arreglo `hooks.afterChange` de la colección Pages. Este ejemplo supone que hay un campo `slug` de nivel superior y que el slug de la página raíz es `home`.

```ts
import { revalidatePath } from 'next/cache'
import type { CollectionAfterChangeHook } from 'payload'

export const revalidatePage: CollectionAfterChangeHook = ({ doc }) => {
  const path = doc.slug === 'home' ? '/' : `/${doc.slug}`

  revalidatePath(path)
  return doc
}
```

Esto invalida la ruta del slug actual; no invalida la ruta anterior después de un cambio de slug, las rutas anidadas ni otras páginas que hagan referencia al documento. Amplía el hook para cubrir esos casos según las reglas de enrutamiento de tu proyecto. También se ejecuta al guardar borradores, así que decide si ese comportamiento se ajusta a tu flujo de publicación.

El ejemplo supone que Payload y el frontend de Next.js se ejecutan en la misma aplicación y pueden usar la misma caché de Next.js. Si se despliegan por separado, utiliza un mecanismo de invalidación específico para tu despliegue. Revisa la [guía de despliegue]({{site}}/docs/getting-started/first-deploy/) antes de depender del comportamiento de la caché en producción.

## Actualizar el código de los hooks

Las firmas de los hooks de Starter forman parte del proyecto generado, por lo que debes revisar `src/starter/define-config` al actualizar. Mantén el código personalizado de los hooks en archivos separados si se comparte entre configuraciones, y prueba las solicitudes tanto de páginas publicadas como de vistas previas después de una actualización.

Los proyectos que migran desde una versión principal anterior deben seguir la [guía de migración a la versión 3]({{site}}/docs/guides/upgrading-to-3/) antes de copiar ejemplos en una configuración existente. En particular, verifica la estructura del bloque y el contexto de la solicitud con los tipos instalados en ese proyecto, en lugar de suponer que un hook anterior recibe los mismos argumentos.
