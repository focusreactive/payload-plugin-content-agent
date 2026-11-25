title: Cómo almacenar en caché el contenido de un CMS con Next.js App Router
excerpt: Una guía práctica para almacenar en caché el contenido publicado de un CMS con Next.js App Router, con vistas previas seguras, invalidación mediante webhooks y comprobaciones de páginas desactualizadas.
seoTitle: Caché de contenido de un CMS con Next.js App Router: guía
seoDescription: Aprende a almacenar en caché el contenido de un CMS con Next.js App Router, mantener privadas las vistas previas, invalidar páginas publicadas y resolver problemas de respuestas desactualizadas.

La caché puede acelerar un sitio con mucho contenido, pero también plantea una pregunta que los editores acabarán haciendo: «Ya publiqué el cambio, ¿por qué no lo veo?». La respuesta depende de qué hayas almacenado en caché, cómo lo invalides y si la solicitud corresponde a una vista previa. Soy Mara Lindqvist, Head of Engineering de {{brand}}. En esta guía de 2026, usaré el App Router de [Next.js](https://nextjs.org) y Cache Components para definir una política clara para el contenido publicado del CMS. Después, mostraré cómo mantener separadas las vistas previas editoriales.

## Empieza con un mapa de contenido y actualización

Antes de escribir código de caché, enumera el contenido que necesita cada ruta y decide con qué rapidez deben aparecer los cambios. Una página de producto puede depender de una entrada de producto, la navegación compartida y un banner de campaña. Invalidar solo la entrada de producto no actualizará el banner si este tiene su propia solicitud almacenada en caché.

| Contenido | Política sugerida | Evento que activa la invalidación | Motivo |
| --- | --- | --- | --- |
| Artículo publicado | Almacenar en caché con una etiqueta específica del artículo | Publicación, retirada o eliminación del artículo | La mayoría de las solicitudes pueden reutilizar el mismo contenido |
| Listado de artículos | Almacenar en caché con una etiqueta de colección | Adición, eliminación o actualización de un artículo | Las tarjetas y el orden pueden cambiar |
| Navegación compartida | Almacenar en caché con una etiqueta de navegación | Publicación de la navegación | Muchas rutas dependen de una sola entrada |
| Vista previa de borrador | Obtener sin almacenamiento persistente en caché | Cada solicitud de vista previa | Los editores necesitan ver el borrador actual |
| Datos específicos del visitante | Mantener fuera de la caché de contenido compartida | Acción del usuario o cambio de sesión | Las respuestas privadas no deben compartirse |

Estos son puntos de partida, no tiempos de caducidad universales. Un aviso urgente puede necesitar una vigencia más corta que una página de archivo. Acuerda un objetivo de actualización con las personas que publican el contenido, incluido lo que debe ocurrir si el CMS deja de estar disponible temporalmente.

El CMS también influye en la implementación. Los eventos de webhook disponibles, las API de borradores y las relaciones entre contenidos varían, así que compáralos antes de elegir un esquema de etiquetas. Nuestra comparación de [los flujos de trabajo de equipos de marketing en dos plataformas CMS]({{site}}/blog/storyblok-vs-contentful/) es un buen punto de partida para tomar esa decisión.

## Define cómo almacenar en caché el contenido publicado

El siguiente ejemplo utiliza Cache Components de Next.js 16. Actívalos con `cacheComponents: true` en `next.config.ts` y coloca esta función en `lib/articles.ts`. El ejemplo presupone que el endpoint de entrega del CMS devuelve un JSON con `title` y `body` para un artículo publicado.

```ts
import { cacheLife, cacheTag } from 'next/cache'

type Article = {
  title: string
  body: string
}

export async function getPublishedArticle(slug: string): Promise<Article> {
  'use cache'

  cacheLife('hours')
  cacheTag(`cms:article:${slug}`)

  const baseUrl = process.env.CMS_DELIVERY_URL
  const token = process.env.CMS_DELIVERY_TOKEN

  if (!baseUrl || !token) {
    throw new Error('Missing CMS delivery configuration')
  }

  const response = await fetch(
    `${baseUrl}/articles/${encodeURIComponent(slug)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!response.ok) {
    throw new Error(`CMS delivery request failed: ${response.status}`)
  }

  return response.json() as Promise<Article>
}
```

Los argumentos de la función forman parte de su clave de caché, por lo que los distintos slugs no comparten el resultado de un artículo. El perfil `hours` define la vigencia de la caché; la etiqueta ofrece una forma independiente de marcar ese resultado como desactualizado después de una publicación. Ninguno sustituye al otro. La vigencia limita el tiempo que el contenido puede permanecer en caché sin que se produzca un evento, mientras que un webhook puede activar una actualización antes.

### Mantén una clave de caché coherente

Valida y normaliza los slugs antes de llamar a la función. El webhook debe usar el mismo slug normalizado al crear la etiqueta. Si el contenido está localizado, incluye la configuración regional tanto en los argumentos de la función como en la etiqueta; de lo contrario, una actualización de una traducción podría dejar otra almacenada en caché de forma incorrecta.

La aserción de TypeScript del ejemplo no valida la respuesta del CMS. En producción, comprueba los campos devueltos en la capa de la API y gestiona el contenido ausente o mal formado. No pases tokens de vista previa, identidades de usuario ni borradores a esta función compartida para contenido publicado.

Para un listado de artículos, usa una función de caché independiente y asígnale la etiqueta `cms:articles`. La etiqueta de una página de detalle por sí sola no puede actualizar una lista que incluya el título, el resumen o la posición del artículo.

## Separa las vistas previas del contenido público

Una vista previa cumple una función distinta a la de una página pública: debe mostrar el borrador actual del editor, no la última respuesta publicada. Usa Draft Mode para identificar una solicitud de vista previa y obtén el borrador mediante la API de vista previa del CMS con `cache: 'no-store'`. Mantén esa solicitud fuera de la función compartida `use cache`.

### Protege el punto de entrada de la vista previa

Una ruta que activa la vista previa debe validar un secreto u otro mecanismo de autenticación compatible con el CMS antes de activar Draft Mode. También debe validar el destino solicitado en lugar de redirigir a una URL arbitraria. Las credenciales de vista previa deben permanecer en el servidor y las respuestas de vista previa no deben almacenarse en la caché de una CDN pública.

Draft Mode identifica la solicitud, pero no garantiza por sí solo que todas las solicitudes al CMS devuelvan contenido actualizado. La página todavía debe elegir el endpoint de borradores y evitar la caché de contenido publicado. Cuando termine la vista previa, desactiva Draft Mode para que el navegador vuelva a la ruta pública.

> **Consejo práctico:** Prueba un cambio en un borrador sin publicarlo. Abre la vista previa y la página pública en sesiones de navegador separadas; el borrador solo debe aparecer en la vista previa autenticada.

Como referencia de implementación, consulta [cómo se configura la vista previa en vivo en {{short}} Starter]({{site}}/docs/guides/live-preview/). La plantilla de código abierto está actualmente en la versión 3.2 y se puede instalar con `npx create-headless-starter`. Adapta su configuración de vista previa a los permisos de tu CMS y a tu entorno de alojamiento.

## Invalida el contenido cuando se publiquen cambios

Un webhook del CMS puede notificar a un Route Handler cuando cambia el contenido publicado. El siguiente ejemplo espera un JSON que contenga el `slug` actual y, si se ha cambiado, un `previousSlug` opcional. Configura el CMS o un intermediario para que envíe esa estructura y se autentique con un secreto de tipo bearer.

```ts
import { revalidateTag } from 'next/cache'

function validSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 120 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  )
}

export async function POST(request: Request) {
  const secret = process.env.CMS_WEBHOOK_SECRET

  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const data = await request.json().catch(() => null)

  if (
    !data ||
    !validSlug(data.slug) ||
    (data.previousSlug !== undefined && !validSlug(data.previousSlug))
  ) {
    return new Response('Invalid payload', { status: 400 })
  }

  revalidateTag(`cms:article:${data.slug}`, 'max')

  if (data.previousSlug) {
    revalidateTag(`cms:article:${data.previousSlug}`, 'max')
  }

  revalidateTag('cms:articles', 'max')

  return Response.json({ accepted: true })
}
```

Con el perfil `max`, `revalidateTag` utiliza el comportamiento stale-while-revalidate: una visita posterior puede recibir contenido desactualizado mientras se obtiene contenido actualizado en segundo plano. No prometas a los editores que la respuesta del webhook significa que todos los visitantes verán la nueva versión de inmediato.

Si tu CMS firma los datos del webhook en lugar de enviar un token de tipo bearer, verifica la firma siguiendo el procedimiento documentado por el proveedor. Protege el secreto, rechaza las solicitudes no autenticadas y evita registrar credenciales o el contenido completo de los borradores.

### Ten en cuenta las relaciones y eliminaciones

Configura eventos para la retirada y eliminación de contenido, además de para la publicación. La API de entrega debe dejar de devolver un artículo eliminado y su listado debe invalidarse. Si cambia un slug, invalida las etiquetas de detalle antigua y nueva, y decide si la ruta antigua debe redirigir o devolver una respuesta de contenido no encontrado.

Los autores, las categorías y la navegación compartidos necesitan su propia estrategia de dependencias. Puedes etiquetar los datos almacenados en caché que representan directamente cada elemento compartido o invalidar de forma explícita las etiquetas de los artículos y listados afectados. La elección adecuada depende de la información que proporcione el webhook del CMS sobre las entradas relacionadas.

## Prueba todo el proceso de publicación

Una solicitud de webhook exitosa es solo una parte de la prueba. Comprueba la página, el CMS y la caché en conjunto, en un entorno similar al de producción.

1. **Carga la caché pública.** Visita un artículo y su listado, y registra el título publicado y el tiempo de respuesta.
2. **Edita sin publicar.** Confirma que el borrador aparece en la vista previa autenticada mientras el artículo público y el listado permanecen sin cambios.
3. **Publica el cambio.** Comprueba que el CMS envía un webhook autenticado y que el controlador lo acepta.
4. **Vuelve a visitar las páginas.** Ten en cuenta el comportamiento stale-while-revalidate y confirma después que el artículo y el listado terminan mostrando el nuevo título.
5. **Prueba un cambio de slug y una retirada.** Verifica la ruta antigua, la nueva y el listado según tus reglas de redirección y retirada de contenido.
6. **Simula un fallo de entrega.** Revisa los registros y las alertas, reintenta el webhook cuando sea posible y confirma que la vigencia de la caché ofrece un mecanismo de respaldo.

Ejecuta la prueba con tu configuración real de alojamiento, no solo en un servidor de desarrollo. El comportamiento en desarrollo no es un sustituto fiable de la caché en producción. En [Vercel](https://vercel.com), inspecciona el comportamiento de la caché y los registros del despliegue; en infraestructura autogestionada, asegúrate de que todas las instancias usen una estrategia de caché que mantenga la invalidación coherente entre ellas.

Una migración de una sala de redacción ofrece otra prueba útil: publica una corrección de un artículo existente, no solo una noticia nueva. Nuestro trabajo para [migrar Tallgrass Media a una sala de redacción headless]({{site}}/case-studies/tallgrass-media/) ilustra un entorno editorial en el que las URL existentes y los flujos de publicación son tan importantes como el contenido nuevo.

## Gestiona la caché como parte de la experiencia editorial

El trabajo con la caché no termina cuando se despliega el código. Explica a los equipos de contenido, en términos claros, la demora prevista después de una publicación y ofréceles una vía para informar de páginas que sigan desactualizadas. Registra los fallos de los webhooks y los errores de actualización de caché con suficiente contexto para identificar el contenido afectado, pero sin exponer secretos.

Supervisa conjuntamente algunos indicadores:

- Éxito en la entrega de webhooks y número de reintentos.
- Tiempo transcurrido entre la publicación y la respuesta pública actualizada.
- Volumen de solicitudes al CMS y tasas de error.
- Tiempos de respuesta de las páginas y fallos de actualización de caché.
- Informes de los editores sobre contenido desactualizado o ausente.

La tasa de aciertos de caché por sí sola no basta. Una tasa alta puede ocultar un fallo en el proceso de invalidación, mientras que una tasa más baja puede ser aceptable para contenido que se actualiza con frecuencia. Compara las mediciones con los objetivos de actualización que acordaste al principio.

Si un editor necesita ver su propia actualización de inmediato, considera si puede realizarse mediante una Server Action de confianza con `updateTag`. Esa API está diseñada para la caducidad inmediata y para que quien realiza un cambio pueda verlo de inmediato en Server Actions; no sustituye al Route Handler del webhook anterior. Para publicaciones iniciadas desde el CMS, diseña la solución en torno al comportamiento real de invalidación y comunícalo.

Por último, revisa la política cuando cambie un modelo de contenido. Un nuevo componente de campaña compartido puede añadir una dependencia a decenas de rutas. Lo mismo ocurre cuando los editores incorporan un nuevo flujo de publicación. Nuestra [investigación sobre lo que los equipos de contenido necesitan de sus herramientas]({{site}}/blog/editor-experience-survey-2026/) aporta contexto para tratar esos flujos como parte del diseño técnico, en lugar de dejarlos para el final.
