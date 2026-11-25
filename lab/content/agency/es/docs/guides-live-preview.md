title: Vista previa en vivo

La vista previa en vivo permite a los editores ver los cambios en los bloques de una página junto al formulario de edición, antes de publicarlos. {{short}} Starter conecta [Payload](https://payloadcms.com) con el App Router de [Next.js](https://nextjs.org) mediante una ruta de vista previa autenticada y el cliente de vista previa en vivo de Payload. El iframe carga inicialmente el borrador guardado y luego se actualiza a medida que el editor modifica los campos del formulario.

## Iniciar el proyecto

Crea un proyecto e inicia el servidor de desarrollo:

```bash
npx create-headless-starter
cd headless-starter
npm run dev
```

El CLI crea un panel de administración de Payload, una colección Pages y un renderizador de bloques. Antes de iniciar el servidor, configura `SERVER_URL` en tu entorno con el origen público del proyecto. El starter utiliza este valor como origen del panel de administración y de la vista previa. En el desarrollo local, usa el mismo origen para acceder tanto al panel de administración como al sitio.

El starter también incluye el paquete `@payloadcms/live-preview-react`, una ruta de vista previa autenticada y un renderizador de páginas en borrador. Si agregas la vista previa en vivo a un proyecto existente, asegúrate de contar con estos componentes antes de activarla.

## Configurar la vista previa

El starter lee la configuración de vista previa desde `starter.config.ts`. Este ejemplo activa la vista previa para la colección Pages y solicita el contenido relacionado con un nivel de profundidad:

```ts
import { defineStarterConfig } from './src/starter/config'

export default defineStarterConfig({
  livePreview: {
    enabled: true,
    collection: 'pages',
    depth: 1,
    showViewportControls: true,
  },
})
```

Reinicia el servidor de desarrollo después de modificar este archivo. El starter utiliza esta configuración al generar la configuración del panel de administración de Payload y cuando su ruta de vista previa carga un borrador.

| Opción | Valor predeterminado | Función |
| --- | --- | --- |
| `enabled` | `false` | Activa el iframe y la ruta de vista previa en vivo. |
| `collection` | `'pages'` | Selecciona la colección cuyos documentos se pueden abrir en la vista previa. |
| `depth` | `1` | Define la profundidad con la que se cargan los documentos relacionados en la vista previa. |
| `showViewportControls` | `true` | Muestra los controles del panel de administración para cambiar el tamaño de la ventana de vista previa. |

Mantén `depth` tan bajo como lo permitan tus bloques. Un bloque que muestra campos de un documento relacionado necesita suficiente profundidad para recibirlos; aumentarla también puede hacer que las solicitudes de borradores consuman más recursos.

> **Nota:** La vista previa solo está disponible para usuarios que hayan iniciado sesión y tengan permiso para leer la página. No es un enlace público para compartir. La ruta de vista previa comprueba la sesión de Payload y el acceso a la colección antes de activar el modo borrador de Next.js.

## Abrir un borrador

1. Inicia sesión en el panel de administración de Payload y abre una página de la colección Pages.
2. Guarda la página como borrador si aún no se ha guardado. La ruta de vista previa necesita un ID de documento para cargar el borrador inicial.
3. Abre el panel de vista previa en vivo. El starter carga el borrador a través de su ruta de vista previa y muestra la página en el iframe.
4. Edita un campo o cambia el orden de un bloque. El iframe se actualiza con el estado del formulario sin publicar la página.
5. Guarda el borrador cuando quieras conservar los cambios. La publicación sigue siendo una acción independiente.

La representación inicial del iframe proviene del borrador guardado. Los cambios enviados desde el editor son temporales hasta que se guardan. Si el iframe se vuelve a cargar antes de guardar un cambio, la vista previa vuelve a comenzar desde el borrador guardado.

## Renderizar datos de bloques en vivo

La página de vista previa del starter pasa el documento inicial de la página y el origen del servidor a un componente de cliente. Ese componente se suscribe a los mensajes de vista previa de Payload y renderiza la versión más reciente del documento con el mismo renderizador de bloques que utiliza el sitio:

```tsx
'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import type { Page } from '@/payload-types'
import { BlockRenderer } from '@/blocks/BlockRenderer'

type Props = {
  initialPage: Page
  serverURL: string
}

export function LivePage({ initialPage, serverURL }: Props) {
  const { data } = useLivePreview<Page>({
    initialData: initialPage,
    serverURL,
    depth: 1,
  })

  return <BlockRenderer blocks={data.layout ?? []} />
}
```

Mantén el valor de `depth` del hook alineado con el de `starter.config.ts`. El `serverURL` que se pasa a este componente debe ser el origen de Payload, para que el cliente acepte mensajes de vista previa del servidor esperado.

Los bloques se encuentran en `src/blocks/`. Cuando agregues uno, registra su esquema de Payload y su renderizador para que los borradores guardados y las actualizaciones en vivo utilicen el mismo tipo de bloque. Sigue los pasos para [agregar un bloque]({{site}}/docs/recipes/add-a-block/) antes de probarlo en el panel de vista previa. Para los bloques con archivos cargados, consulta también la guía sobre [gestión de imágenes]({{site}}/docs/guides/image-handling/).

## Despliegue y solución de problemas

Las solicitudes de vista previa deben llegar al servidor de la aplicación: una exportación estática no puede ejecutar la ruta de vista previa autenticada ni activar el modo borrador. Configura `SERVER_URL` con el origen del proyecto desplegado y completa las comprobaciones de la [guía del primer despliegue]({{site}}/docs/getting-started/first-deploy/) antes de invitar a los editores.

Si el panel permanece en blanco, primero confirma que el editor haya iniciado sesión en el mismo origen y tenga permiso para leer la página. Luego comprueba que la página tenga un borrador guardado, que `livePreview.enabled` esté en `true` y que el servidor se haya reiniciado después de los cambios de configuración. El proxy inverso o la política de seguridad también deben permitir que el panel de administración incruste la página de vista previa en un iframe.

Si la página carga, pero los cambios no aparecen, revisa la consola del navegador en busca de errores de origen de mensajes y confirma que `serverURL` coincida con el origen de Payload. Si falta un bloque, comprueba el registro de su renderizador y la estructura de sus datos en `layout`. Los cambios en documentos relacionados no reemplazan el guardado de esos documentos; guárdalos y luego vuelve a cargar la vista previa para verificar que los datos relacionados se hayan cargado correctamente.
