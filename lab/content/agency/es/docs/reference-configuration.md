title: Referencia de configuración

{{short}} Starter utiliza `starter.config.ts` para configurar en un solo lugar la dirección del sitio, los bloques de página disponibles y el comportamiento de la vista previa. El archivo conecta la [aplicación Next.js App Router](https://nextjs.org) del starter con su [instalación de Payload CMS](https://payloadcms.com); no reemplaza los archivos de configuración propios de ninguno de los dos frameworks. Las siguientes opciones se aplican a los proyectos creados con `npx create-headless-starter`.

## Archivo de configuración

Coloca `starter.config.ts` en la raíz del proyecto, junto a `package.json`. El starter lo carga al iniciar la aplicación y comprueba sus valores antes de inicializar Payload. El proyecto generado incluye un tipo `StarterConfig`, por lo que TypeScript puede detectar propiedades mal escritas y valores incompatibles.

Una configuración habitual tiene este aspecto:

```ts
import type { StarterConfig } from './src/lib/starter/types'
import { Hero } from './src/blocks/Hero/config'
import { RichText } from './src/blocks/RichText/config'

const config = {
  siteUrl: process.env.SITE_URL ?? '',
  blocks: [Hero, RichText],
  preview: {
    enabled: true,
    allowedOrigins: [process.env.SITE_URL ?? ''],
    secretEnv: 'PREVIEW_SECRET',
  },
} satisfies StarterConfig

export default config
```

La configuración es código del servidor. Puede leer variables de entorno, pero no debes importarla en un componente de cliente ni incluir secretos directamente en el archivo. El starter lee el secreto del entorno cuando se solicita una vista previa.

## Opciones

El starter valida estas propiedades al iniciarse. Si un valor obligatorio no es válido, la inicialización se detiene y se muestra un error que identifica la propiedad.

| Opción | Tipo | Descripción |
| --- | --- | --- |
| `siteUrl` | `string` | Origen absoluto obligatorio que se utiliza para las URL canónicas y los enlaces de vista previa. No incluyas una ruta ni una barra final. |
| `blocks` | `Block[]` | Arreglo ordenado obligatorio de definiciones de bloques de Payload disponibles en el campo de diseño de Pages. |
| `preview.enabled` | `boolean` | Habilita la ruta de vista previa de borradores del starter cuando su valor es `true`. |
| `preview.allowedOrigins` | `string[]` | Orígenes autorizados para recibir mensajes de vista previa. Cada entrada debe ser un origen absoluto sin ruta. |
| `preview.secretEnv` | `string` | Nombre de la variable de entorno del servidor que contiene el secreto de vista previa. |

Cuando la vista previa está desactivada, el starter no requiere un secreto de vista previa. Limita `allowedOrigins` a los orígenes donde los editores realmente abren el sitio. Añadir un origen no hace público el sitio; esta opción controla qué orígenes pueden participar en el intercambio de mensajes de vista previa del starter.

`siteUrl` debe coincidir con el origen público del entorno actual. Configúralo por separado para desarrollo local, staging y producción, en lugar de incluir en el repositorio un valor específico de un entorno. Si un despliegue utiliza un dominio personalizado, actualiza `SITE_URL` para ese despliegue y reinicia la aplicación.

## Registro de bloques

Cada entrada de `blocks` es una definición de bloque de Payload. El starter utiliza el arreglo para completar el campo de diseño de la colección Pages, siguiendo el orden en que aparecen los bloques en el editor. Las definiciones se encuentran en `src/blocks/`; sus valores de `slug` deben ser únicos porque el contenido guardado de cada página identifica el tipo de bloque mediante ese identificador.

Por ejemplo, `src/blocks/Hero/config.ts` puede definir un bloque principal sencillo:

```ts
import type { Block } from 'payload'

export const Hero: Block = {
  slug: 'hero',
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
  ],
}
```

Una definición de bloque controla los campos que pueden completar los editores, no cómo se renderiza el bloque. Añade el componente correspondiente al renderizador de bloques del starter antes de publicar páginas que utilicen un bloque nuevo. La guía sobre [definiciones y renderizadores de bloques]({{site}}/docs/reference/blocks/) explica cómo asociarlos.

Eliminar un bloque de la configuración impide que los editores lo añadan a nuevos diseños. Esto no elimina automáticamente las instancias existentes de las páginas guardadas. Migra o elimina esas instancias antes de borrar la definición y el renderizador; de lo contrario, es posible que las páginas afectadas dejen de renderizarse correctamente.

## Configuración de la vista previa

Cuando `preview.enabled` está configurado como `true`, el starter proporciona una ruta de vista previa de borradores y utiliza `siteUrl` para crear enlaces a ella. `preview.secretEnv` es el nombre de una variable de entorno, no el secreto en sí. En el ejemplo, la aplicación lee el valor de `PREVIEW_SECRET` en el servidor.

Utiliza un secreto largo generado de forma aleatoria y proporciona el mismo valor a todas las instancias de la aplicación en un entorno. Rótalo mediante el almacén de secretos de tu despliegue y, después, reinicia todas las instancias. Es posible que los editores con un enlace de vista previa anterior deban abrir uno nuevo tras la rotación.

> **Nota:** El secreto de vista previa protege el acceso al contenido en borrador. Nunca le añadas el prefijo `NEXT_PUBLIC_`, lo incluyas en código del cliente ni lo guardes en el control de versiones.

Para configurar el editor y conocer el flujo de mensajes entre la interfaz de administración y el sitio, consulta [cómo habilitar las actualizaciones de borradores]({{site}}/docs/guides/live-preview/).

## Aplicar cambios

Después de crear un proyecto, sigue estos pasos para configurarlo y ejecutarlo:

1. Crea el proyecto e instala sus dependencias. Si necesitas consultar los requisitos previos, sigue las [instrucciones de configuración del proyecto]({{site}}/docs/getting-started/installation/).
2. Configura `SITE_URL` y `PREVIEW_SECRET` en tu entorno local. Para un despliegue, añádelos mediante la configuración de entorno del proveedor de alojamiento.
3. Edita `starter.config.ts` y registra los bloques que necesitan tus páginas.
4. Inicia la aplicación, abre el editor de Pages y confirma que el campo de diseño muestra los bloques registrados.

Por ejemplo, puedes iniciar un proyecto nuevo en una sesión de terminal utilizando los scripts de npm generados:

```bash
npx create-headless-starter my-site --skip-install
cd my-site
npm install
export SITE_URL="{{site}}"
export PREVIEW_SECRET="$(openssl rand -hex 32)"
npm run dev
```

Los valores exportados solo duran durante esa sesión de terminal. Reinicia el servidor de desarrollo después de cambiar la configuración o los valores de entorno para que el starter vuelva a cargarlos y validarlos. Antes de desplegar un cambio en los bloques, prueba tanto una página existente como una recién creada; ambas necesitan un renderizador que reconozca los tipos de bloque guardados.
