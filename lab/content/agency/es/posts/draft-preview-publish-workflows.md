title: Del borrador a la publicación: flujos de trabajo editoriales en un CMS headless
excerpt: Una guía práctica para diseñar flujos de borrador, vista previa, aprobación y publicación que den confianza a los editores sin ralentizar la entrega.
seoTitle: Flujos editoriales en un CMS headless: del borrador a la publicación
seoDescription: Aprende a diseñar borradores, vistas previas seguras, aprobaciones y controles de publicación en un CMS headless, con ejemplos prácticos para equipos editoriales.

Un CMS headless separa la gestión de contenidos de los sitios web y las aplicaciones que los muestran. Esta separación da flexibilidad a los equipos, pero también significa que el conocido botón «Publicar» es solo una parte del flujo de trabajo. Los editores necesitan ver los cambios no publicados en contexto, quienes revisan deben saber qué versión están aprobando y los desarrolladores deben impedir que los borradores aparezcan en las respuestas públicas. Soy Ines Okafor, estratega de contenidos en {{brand}}. En esta guía explico las decisiones que permiten que cada paso sea fiable, desde el primer borrador hasta una publicación segura.

## Define los estados antes de elegir los botones

Empieza por acordar qué significa cada estado, quién puede cambiarlo y qué ocurre en el sitio público. Un flujo sencillo puede servir para la mayoría de los artículos sin obligar a someter cada corrección tipográfica a una larga revisión.

| Estado | Qué significa | Responsable habitual | Efecto público |
|---|---|---|---|
| Borrador | El contenido se está redactando o revisando | Autor | Ninguno |
| En revisión | Una revisión específica está lista para recibir comentarios | Editor | Ninguno |
| Aprobado | La revisión evaluada está autorizada para su publicación | Responsable de aprobación | Ninguno |
| Programado | Una revisión aprobada tiene una hora de publicación | Responsable de publicación | Se publica a la hora programada |
| Publicado | La revisión está disponible para los canales de distribución | Responsable de publicación | Visible después de la distribución y la actualización de la caché |

Un artículo ya publicado también puede tener cambios pendientes de publicación. Trata la versión pública y la revisión en curso como elementos distintos: guardar una corrección no debería reemplazar sin aviso lo que ven los lectores.

[Payload](https://payloadcms.com), [Sanity](https://www.sanity.io) y [Storyblok](https://www.storyblok.com) admiten flujos de trabajo editoriales, pero sus interfaces y configuraciones son diferentes. Por ejemplo, Storyblok ofrece un editor visual, mientras que Payload da a los desarrolladores control sobre la aplicación y el modelo de contenido. Revisa las capacidades y el plan del producto que elijas, en lugar de asumir que las aprobaciones, la programación y la vista previa visual funcionan igual en todas las plataformas.

La tabla ofrece un vocabulario compartido, no una obligación de crear cinco estados personalizados. Si un CMS gestiona la publicación programada por separado del estado editorial, documenta esa distinción. Lo importante es que los autores puedan identificar qué está publicado, qué está cambiando y a quién le corresponde actuar.

## Diseña el modelo de contenido para la revisión

Una vista previa solo es útil si el modelo de contenido recoge lo que necesitan evaluar quienes revisan. Incluye en cada artículo un título, un resumen, el cuerpo, el autor, una imagen destacada y metadatos de búsqueda cuando esos campos sean pertinentes. Marca como obligatorios los campos que realmente lo sean, pero evita bloquear un borrador inicial porque aún no se haya seleccionado la imagen definitiva.

### Separa los campos editoriales de los de distribución

El segmento de la URL pública y la fecha de publicación afectan a la distribución. Una nota interna de revisión, no. Mantén separados estos aspectos para evitar que las notas aparezcan por accidente en una respuesta de la API utilizada por el sitio público.

En el caso del contenido reutilizable, decide si una revisión apunta a una versión específica de un elemento compartido o a la más reciente. Una página aprobada con un banner promocional podría verse diferente al publicarse si ese banner compartido cambia entre tanto. Puedes fijar la versión de la dependencia o informar a quien revisa de que puede cambiar de forma independiente.

### Establece responsables

Asigna un responsable para cada decisión, no solo para cada documento. Un autor puede proponer un cambio, un editor puede aprobar la redacción y un responsable de publicación puede publicarlo. En un equipo pequeño, una persona puede asumir más de un rol; aun así, el registro debe indicar qué acción realizó.

Incluye estas reglas en el modelo o en el flujo de trabajo que lo acompaña:

- Registra la revisión y la hora asociadas a cada aprobación.
- Anula o renueva la aprobación cuando una edición sustancial modifique esa revisión.
- Identifica claramente a la persona responsable de la publicación.
- Conserva un historial de cambios y publicaciones para facilitar la recuperación.
- Define qué ocurre cuando se elimina o reemplaza un recurso al que se hace referencia.

Prueba el modelo con un artículo existente, incluidas sus imágenes y enlaces. Un modelo que parece ordenado en un diagrama puede resultar poco práctico cuando un editor necesita actualizar un solo párrafo sin alterar el resto de la página.

## Ofrece a los editores una vista previa segura y fiel

La vista previa debe mostrar el borrador con las mismas plantillas y componentes que utiliza el sitio público. También debe dejar claro que se está viendo contenido sin publicar. Un aviso de vista previa destacado es más útil que un cambio sutil en la dirección del navegador.

### Conecta el CMS con el frontend

En un sitio de Next.js, Draft Mode permite indicar a la aplicación que solicite contenido en borrador. La siguiente ruta lo activa después de comprobar un secreto compartido y un slug de artículo con caracteres restringidos. El ejemplo muestra el punto de entrada en el frontend; la página aún debe obtener el borrador correspondiente del CMS.

```ts
import { draftMode } from 'next/headers'
import { redirect } from 'next/navigation'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const secret = process.env.PREVIEW_SECRET
  const slug = params.get('slug')

  if (
    !secret ||
    params.get('secret') !== secret ||
    !slug ||
    !/^[a-z0-9-]+$/.test(slug)
  ) {
    return new Response('Invalid preview request', { status: 401 })
  }

  const draft = await draftMode()
  draft.enable()
  redirect(`/articles/${slug}`)
}
```

La restricción del slug impide que la solicitud elija un destino de redirección arbitrario. Guarda el secreto fuera del control de versiones, sustitúyelo si queda expuesto y evita registrar las URL de vista previa: un secreto en una cadena de consulta puede filtrarse a través de los registros o del historial del navegador. Para una protección mayor, utiliza enlaces de vista previa autenticados y de corta duración, y verifica que la persona tenga permiso para ver el contenido.

Draft Mode no es un sistema de control de acceso para el CMS. Utiliza una credencial del lado del servidor con solo los permisos necesarios para leer borradores, nunca la envíes al navegador y asegúrate de que las respuestas con borradores no se compartan a través de una caché pública. Ofrece también una forma de salir del modo de vista previa.

> **Consejo práctico:** Revisa el borrador tanto en una pantalla estrecha como en una amplia. Comprueba los recortes de imágenes, los encabezados largos y las llamadas a la acción antes de solicitar la aprobación final.

La vista previa también necesita una alternativa cuando falta contenido. El editor debería ver un mensaje útil si no está disponible un recurso obligatorio o una entrada relacionada, en lugar de una página en blanco. Nuestro [trabajo de desarrollo con Next.js]({{site}}/nextjs-development/) sigue el mismo principio: las herramientas editoriales forman parte de la experiencia de la aplicación, no son un añadido de última hora.

## Convierte la revisión en una secuencia repetible

Un proceso de revisión funciona cuando todos saben qué hacer a continuación y qué versión se está evaluando. Los comentarios en un chat pueden ayudar a resolver dudas, pero la aprobación debe quedar vinculada a la revisión del contenido o registrada junto a ella.

1. **Prepara el borrador.** El autor completa el contenido, añade los recursos y comprueba en la vista previa que no haya problemas evidentes de diseño.
2. **Solicita la revisión.** El autor identifica a la persona que revisará, el plazo y las preguntas específicas, como si es necesario verificar una afirmación.
3. **Revisa la página tal como se muestra.** La persona encargada comprueba el significado, los enlaces, la accesibilidad y la presentación, no solo los campos de texto del CMS.
4. **Atiende los comentarios.** El autor realiza los cambios y solicita otra revisión si la versión ha cambiado de forma sustancial.
5. **Aprueba la revisión.** La persona responsable confirma la versión exacta que puede publicarse, incluido cualquier contenido referenciado que requiera aprobación.
6. **Publica y verifica.** La persona responsable publica el contenido y después comprueba la página pública y sus enlaces importantes.

No todos los cambios necesitan seguir el mismo proceso. Un editor de confianza podría publicar una corrección de bajo riesgo, mientras que una página de políticas podría requerir una revisión adicional por parte de un especialista. Documenta las excepciones para que no se conviertan en atajos invisibles.

Al migrar un sitio existente, relaciona los estados y roles de usuario antiguos con los nuevos antes de importar el contenido. Una marca de «publicado» importada no indica necesariamente si una página se revisó, quién es su responsable o si sus recursos multimedia siguen siendo válidos. La [lista de comprobación de migración que utilizamos]({{site}}/blog/wordpress-to-headless-migration-checklist/) es un recurso útil para revisar esas dependencias antes de adoptar el nuevo flujo de trabajo.

## Publica la revisión aprobada, no simplemente el último borrador

La regla principal de publicación es sencilla: si se produce un cambio después de la aprobación, el sistema no debe considerar aprobada automáticamente la nueva revisión. La siguiente función de TypeScript expresa esa regla sin depender de un CMS concreto:

```ts
type Revision = {
  id: string
  approvedRevisionId: string | null
  requiredFieldsComplete: boolean
}

function canPublish(revision: Revision): boolean {
  return (
    revision.requiredFieldsComplete &&
    revision.approvedRevisionId === revision.id
  )
}
```

Una implementación en producción también necesita autorización, un historial de revisiones persistente y una comprobación atómica en el momento de publicar. De lo contrario, una revisión podría cambiar entre la comprobación y la publicación. Las tareas programadas deben realizar las mismas comprobaciones al ejecutarse, no solo cuando alguien establece la programación por primera vez.

### Prevé retrasos y fallos en la distribución

La publicación en el CMS y la visibilidad en el sitio pueden ocurrir en momentos distintos. Según la arquitectura, el frontend podría necesitar la invalidación de la caché, una nueva compilación u otro paso de distribución. Muestra a los editores un resultado claro: publicado en el CMS, distribución pendiente, distribuido o fallido, con una opción para reintentar.

Para publicaciones con plazos críticos, acuerda la zona horaria y qué ocurrirá si falla la distribución. Mantén disponible la revisión publicada anterior para que una persona autorizada pueda restaurarla. La reversión es una nueva acción de publicación deliberada, no algo que se consiga necesariamente al eliminar un borrador.

La elección del alojamiento influye en cómo se implementan estos pasos de distribución. Compara las necesidades de compilación, caché y operación del flujo de trabajo junto con las [opciones de alojamiento para Next.js en 2026]({{site}}/blog/best-nextjs-hosting-platforms-2026/), en lugar de elegir una plataforma únicamente por su interfaz de despliegue.

## Gestiona el flujo de trabajo después del lanzamiento

El flujo de trabajo no termina cuando se publica la primera página. Ofrece a los editores una guía operativa breve que explique cómo solicitar una vista previa, a quién pedir la aprobación, cómo programar una publicación y qué hacer si falla. Utiliza ejemplos de los tipos de contenido del propio equipo en lugar de un recorrido genérico por todas las pantallas del CMS.

Revisa los permisos cuando las personas cambien de rol. Los autores pueden necesitar acceso a los borradores sin permiso para publicar; quienes revisan de forma temporal pueden necesitar acceso solo a un conjunto definido de contenidos. Los registros de auditoría ayudan a investigar cambios inesperados, pero alguien debe responsabilizarse de revisarlos y actuar en consecuencia.

Prueba también los casos menos frecuentes: un enlace de vista previa vencido, una publicación programada a la que le falta un recurso, un artículo revertido y una vista previa abierta después de que un editor haya cerrado sesión. Estos casos revelan si los mensajes de error indican qué hacer o si simplemente informan de que algo salió mal.

### Mide los obstáculos además de la velocidad

Haz seguimiento del tiempo transcurrido entre la solicitud de revisión y la aprobación, el número de revisiones devueltas por falta de información y los intentos de publicación fallidos. Interpreta esos indicadores junto con los editores. Una revisión más larga puede ser apropiada para una página delicada; una publicación rápida no sirve de mucho si omite comprobaciones necesarias.

Por último, revisa la configuración de distribución cuando cambien el volumen de contenido o la frecuencia de publicación. Una comparación de [Vercel y Netlify para proyectos headless]({{site}}/blog/vercel-vs-netlify/) puede ayudar a plantear preguntas sobre el despliegue y las operaciones, pero la elección adecuada depende de la aplicación y del equipo que la mantiene.
