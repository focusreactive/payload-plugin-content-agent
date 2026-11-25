title: Redirecciones

Las redirecciones llevan a los visitantes de una ruta antigua a una nueva sin que un editor tenga que mantener publicada una página obsoleta. {{short}} Starter almacena las reglas de redirección en [Payload](https://payloadcms.com) y las consulta en el App Router de [Next.js](https://nextjs.org) antes de renderizar una página. Usa una redirección temporal mientras pruebas el cambio y una permanente cuando la dirección antigua ya no deba indexarse.

## Habilitar las redirecciones

Para un proyecto nuevo, crea el starter con `npx create-headless-starter`. En un proyecto existente basado en el starter, habilita la función de redirecciones en `starter.config.ts`:

```ts
import { defineStarterConfig } from './src/starter/defineStarterConfig'

export default defineStarterConfig({
  redirects: {
    enabled: true,
    defaultStatus: 307,
  },
})
```

La configuración de Payload del starter lee este archivo y registra la colección `redirects` cuando la función está habilitada. Reinicia el servidor de desarrollo después de cambiar la configuración. Si más adelante deshabilitas la función, los registros de redirección existentes se conservan, pero el controlador de la ruta no puede acceder a ellos hasta que vuelvas a habilitarla.

El starter también incluye bloques de página en `src/blocks/`. Las redirecciones son independientes de esos bloques: resuelven la solicitud antes de que se rendericen la página de destino y sus bloques.

## Campos de redirección

Crea y edita las reglas en la colección **Redirects** del panel de administración de Payload. La ruta de origen debe ser única, incluso cuando una regla esté deshabilitada.

| Campo | Función | Ejemplo |
| --- | --- | --- |
| Origen | Ruta exacta que debe coincidir, comenzando por `/` | `/old-services` |
| Destino | Ruta interna a la que se envía al visitante | `/services` |
| Estado | Temporal `307` o permanente `308` | `308` |
| Habilitada | Controla si se aplica la regla | `true` |

Las rutas distinguen entre mayúsculas y minúsculas. Introduce la ruta sin una barra final, excepto para la ruta raíz `/`. La colección valida este formato y rechaza cadenas de consulta, fragmentos y URL externas en ambos campos de ruta. Las cadenas de consulta de las solicitudes entrantes no se incluyen en la búsqueda ni se envían al destino.

El estado predeterminado configurado se aplica a los registros nuevos. Cambiarlo no actualiza las reglas existentes. Un `307` conserva el método de la solicitud y resulta útil para un cambio que podrías revertir. Un `308` también conserva el método e indica a los clientes y motores de búsqueda que el cambio es permanente. Los navegadores pueden guardar en caché las redirecciones permanentes, así que prueba la regla con `307` antes de cambiarla a `308`.

> **Nota:** Las reglas se aplican a la ruta completa, no a un prefijo. Una redirección desde `/old-services` no redirige también `/old-services/design`; crea una regla independiente para esa ruta.

## Resolver reglas en el App Router

La siguiente ruta opcional que captura todas las rutas comprueba las reglas habilitadas antes de solicitar al starter que renderice una página. Añádela en `src/app/[[...slug]]/page.tsx` y, si ya tienes una página de este tipo en el starter, reemplázala:

```tsx
import config from '@payload-config'
import { getPayload } from 'payload'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { renderPage } from '@/starter/renderPage'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}) {
  const { slug = [] } = await params
  const path = slug.length ? `/${slug.join('/')}` : '/'
  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'redirects',
    where: {
      and: [
        { source: { equals: path } },
        { enabled: { equals: true } },
      ],
    },
    limit: 1,
    depth: 0,
  })

  const rule = result.docs[0]

  if (rule?.status === '308') permanentRedirect(rule.destination)
  if (rule) redirect(rule.destination)

  const page = await renderPage(path)
  if (page === null) notFound()

  return page
}
```

La función auxiliar `renderPage` incluida en el starter devuelve la página correspondiente o `null`. Regenera los tipos de Payload después de habilitar la colección para que `redirects` esté disponible entre los tipos generados. El comando de generación de tipos del starter es `npx payload generate:types`.

La ruta dinámica consulta la regla vigente en cada solicitud, por lo que los cambios en su habilitación se aplican sin necesidad de generar una nueva compilación. Esto también significa que la ruta necesita acceso a la base de datos de Payload durante la ejecución. Las rutas explícitas del App Router tienen prioridad sobre la ruta que captura todas las demás, por lo que este controlador no redirige las rutas gestionadas por un archivo de ruta independiente.

## Añadir y probar una regla

1. Abre **Redirects** en el panel de administración de Payload y crea un registro con la ruta antigua como origen.
2. Establece como destino una página interna existente. Mantén el estado en `307` y habilita la regla.
3. Guarda el registro y solicita la ruta antigua sin seguir las redirecciones:

   ```bash
   curl -I http://localhost:3000/old-services
   ```

4. Comprueba que la respuesta sea `307` y que la cabecera `Location` contenga el destino. Visita el destino directamente para confirmar que se renderiza la página prevista.
5. Cuando el cambio sea definitivo, cambia el estado a `308` y vuelve a probar.

Evita redirigir un destino de vuelta a su origen, ya sea directamente o a través de otra regla. El controlador realiza una búsqueda por solicitud; no detecta cadenas ni bucles. Revisa ambas rutas antes de habilitar una regla, especialmente cuando reemplaces una redirección anterior.

## Coordinar la publicación y los idiomas

Las redirecciones y las páginas tienen ciclos de vida independientes. Si un destino aún no está publicado, los visitantes pueden llegar a una página no encontrada aunque la redirección funcione correctamente. Publica primero el destino y después habilita la regla. Para los lanzamientos programados, consulta cómo [programar la publicación de una página]({{site}}/docs/recipes/scheduled-publishing/) antes de decidir cuándo activar la redirección.

Los prefijos de idioma forman parte de la ruta de origen. Por ejemplo, `/fr/ancien` y `/en/old` requieren registros independientes. Usa la misma convención para los destinos y revisa la [configuración de rutas por idioma]({{site}}/docs/guides/localization/) del proyecto antes de añadir reglas.

Si añades validaciones personalizadas o funciones de auditoría a la colección, mantenlas en un hook de Payload en lugar de incorporarlas a la ruta de la página. La [guía de hooks de colecciones]({{site}}/docs/reference/hooks/) explica dónde se ejecutan esas comprobaciones.
