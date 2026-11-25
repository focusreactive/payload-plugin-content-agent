title: Migración de Sanity a Payload: guía paso a paso
excerpt: Planifica una migración de CMS headless que conserve el contenido, las relaciones, las URL y los flujos editoriales, y que ofrezca a tu equipo una ruta segura hacia el lanzamiento.

seoTitle: Guía práctica para migrar tu CMS headless de forma segura
seoDescription: Aprende a mapear contenido, trasladar recursos, validar páginas y planificar una transición reversible al cambiar el CMS de un sitio web existente.

Migrar de [Sanity](https://www.sanity.io) a [Payload](https://payloadcms.com) implica mucho más que exportar e importar datos. Hay que adaptar los tipos de documentos, las referencias, los recursos y las reglas de publicación, sin dejar de ofrecer una buena experiencia a editores y visitantes. Esta guía explica cómo realizar la migración por etapas, desde el inventario hasta la transición, e incluye un pequeño ejemplo de importación que puedes adaptar a tus propios esquemas.

Por Daniel Whitlock, arquitecto de soluciones en {{brand}}.

## Empieza por el inventario y define el alcance de la migración

Antes de escribir un script, acuerda qué debe contener el nuevo sistema el día del lanzamiento. Exporta una lista de los tipos de documentos de Sanity y contabiliza los documentos publicados, los borradores, los recursos y las referencias. Registra qué campos son obligatorios, cuáles están localizados y cuáles se completan mediante integraciones en lugar de editores.

Incluye el frontend en el inventario. Un esquema puede contener campos que ninguna página utiliza, mientras que una página puede depender de una consulta GROQ, una transformación de imagen o un comportamiento de vista previa que no resulta evidente al examinar el esquema. Identifica la consulta y los tipos de documentos asociados a cada plantilla de página importante.

Define claramente el alcance de la migración del contenido histórico. Por ejemplo, podrías migrar todos los artículos publicados, pero archivar por separado las páginas de campañas obsoletas. Pide a un responsable editorial que apruebe las exclusiones; eliminar contenido que parece no utilizarse sin comprobarlo puede romper enlaces antiguos o eliminar material necesario para cumplir requisitos normativos.

Confirma también que Payload se adapta al modelo de alojamiento y operación previsto. Se ejecuta en tu propio entorno de aplicación, por lo que el equipo necesita un plan para la base de datos, el almacenamiento de archivos, los despliegues, los secretos y las copias de seguridad. Si aún estás evaluando opciones de CMS, nuestra [comparativa de Payload y Strapi]({{site}}/blog/payload-vs-strapi/) analiza algunas de esas ventajas y limitaciones.

Un inventario útil incluye:

- Tipos de documentos, cantidades y responsables.
- Estados de publicación y borrador, incluido el trabajo programado.
- Referencias, objetos reutilizables y campos localizados.
- Tipos de recursos, requisitos de almacenamiento y metadatos de imágenes.
- Rutas, redirecciones, vistas previas e integraciones externas.

## Diseña el modelo de contenido de destino

Crea las colecciones y los elementos globales de Payload antes de importar contenido de producción. Una colección es adecuada para registros repetibles, como los artículos; un elemento global puede contener contenido único, como la navegación del sitio. Respeta la finalidad editorial en lugar de copiar mecánicamente todos los campos de Sanity.

| Origen en Sanity | Destino en Payload | Decisión pendiente |
|---|---|---|
| Tipo de documento | Colección o elemento global | ¿Es contenido repetible o un elemento único? |
| Referencia a documento | Campo de relación | ¿A qué colección apunta y puede tener varios valores? |
| Portable Text | Campo de texto enriquecido o bloques estructurados | ¿Cómo se representarán las marcas, los objetos incrustados y los enlaces? |
| Recurso de imagen o archivo | Colección de archivos | ¿Qué metadatos e información de recorte deben conservarse? |
| Valor específico de un idioma | Campo localizado o registro independiente | ¿Cómo se gestionarán las traducciones ausentes y los valores alternativos? |
| Slug | Campo de texto o slug | ¿Debe mantenerse sin cambios la ruta pública existente? |

### Conserva la identidad y las relaciones

Asigna a cada registro migrado un campo `legacyId` que contenga su ID de documento de Sanity. Configúralo como único en Payload. Así, los scripts de importación dispondrán de una clave de búsqueda estable y podrás volver a ejecutarlos sin depender de un título o slug que un editor pueda cambiar.

Las referencias requieren un plan aparte. Una referencia de Sanity almacena un ID de documento, pero una relación de Payload debe apuntar a un ID de la colección de destino. Importa primero los registros, crea una correspondencia entre los ID anteriores y los ID de Payload y, después, resuelve las relaciones en una segunda pasada. Informa de los destinos ausentes en lugar de descartar los enlaces sin aviso.

### Define cómo funcionarán el texto enriquecido y la localización

Portable Text es un formato de datos estructurados, no HTML. Adapta sus bloques, fragmentos de texto, marcas y objetos incrustados al formato de texto enriquecido configurado en Payload. Prueba por separado los enlaces, las listas, los encabezados, las anotaciones en línea y los elementos incrustados personalizados. Convertir el contenido a texto plano puede ser aceptable para un campo concreto, pero no constituye una migración sin pérdida de información.

Para los sitios multilingües, documenta los códigos de idioma de origen y destino, así como el comportamiento de los valores alternativos para cada campo. Decide si un valor sin traducir permanece vacío o hereda el de otro idioma. Para conocer mejor las decisiones relacionadas con el modelo de contenido, consulta [cómo Verdan Health reunió seis idiomas en una sola plataforma]({{site}}/case-studies/verdan-health/).

## Exporta el contenido y los recursos

Exporta el conjunto de datos de Sanity que corresponda y guárdalo de forma segura. La CLI de Sanity puede exportar documentos y recursos juntos; el nombre del conjunto de datos que aparece a continuación es un ejemplo y debe coincidir con el de tu proyecto:

```bash
npx sanity dataset export production ./sanity-export.tar.gz
```

Conserva el archivo original sin modificar. Extrae una copia de trabajo en un entorno de acceso restringido, identifica el archivo de documentos NDJSON y crea una lista independiente de los recursos referenciados. Si el conjunto de datos es grande, comprueba el espacio disponible en disco antes de extraerlo y evita colocar el archivo comprimido en un directorio web público.

Los ID de borrador de Sanity utilizan el prefijo `drafts.`. Por eso, un documento publicado y su borrador pueden aparecer como registros separados en una exportación. Decide si migrarás el último borrador, la versión publicada o ambos a una colección de Payload configurada para borradores y versiones. No los trates como artículos sin relación entre sí.

Los recursos necesitan su propia conciliación. Para cada archivo referenciado, registra su ID de origen, nombre de archivo, tipo MIME y metadatos relevantes. Transfiere el archivo binario a una colección de archivos de Payload y sustituye las referencias a los recursos de origen por los ID de los nuevos archivos. Conserva el texto alternativo cuando esté almacenado en el contenido, no solo los metadatos del recurso. Comprueba también los recortes y puntos de interés de las imágenes: el frontend puede necesitar transformaciones equivalentes, en lugar de una simple copia del archivo.

> **Consejo práctico:** Realiza la primera exportación e importación con una muestra representativa que incluya un borrador, una traducción, un objeto incrustado y una imagen recortada. Corrige el mapeo antes de procesar el conjunto de datos completo.

## Importa en pasadas repetibles

Desarrolla el importador para el esquema de destino, no al revés. El siguiente ejemplo solo procesa documentos `post` publicados en Sanity que tengan título y slug. Da por hecho que existe una colección `articles` en Payload con los campos de texto obligatorios `title` y `slug`, además de un campo de texto único `legacyId`. Deliberadamente, no migra el cuerpo del contenido, los recursos, los borradores ni las relaciones.

Ejecútalo en un entorno de pruebas desde un proyecto de Payload en el que `@payload-config` se resuelva correctamente y `tsx` esté disponible. Coloca el archivo de documentos extraído en la ruta indicada y asegúrate de que sus registros se puedan importar de forma segura conforme a la configuración de publicación de la colección de destino.

```ts
import { readFile } from 'node:fs/promises'
import { getPayload } from 'payload'
import config from '@payload-config'

type SanityPost = {
  _id: string
  _type: string
  title?: string
  slug?: { current?: string }
}

async function main() {
  const payload = await getPayload({ config })
  const input = await readFile('./export/production.ndjson', 'utf8')
  const lines = input.split('\n').filter((line) => line.trim())

  for (const line of lines) {
    const doc = JSON.parse(line) as SanityPost
    if (doc._type !== 'post' || doc._id.startsWith('drafts.')) continue

    if (!doc.title || !doc.slug?.current) {
      throw new Error(`Missing title or slug for ${doc._id}`)
    }

    const data = {
      legacyId: doc._id,
      title: doc.title,
      slug: doc.slug.current,
    }
    const existing = await payload.find({
      collection: 'articles',
      where: { legacyId: { equals: doc._id } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    if (existing.docs[0]) {
      await payload.update({
        collection: 'articles',
        id: existing.docs[0].id,
        data,
        overrideAccess: true,
      })
    } else {
      await payload.create({
        collection: 'articles',
        data,
        overrideAccess: true,
      })
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

La búsqueda permite repetir esta pequeña pasada, pero no es una solución completa de migración. Se detiene ante el primer registro mal formado, carga el archivo en memoria y presupone que no hay importaciones simultáneas. Para un conjunto de datos grande, procesa la entrada en streaming, registra los errores con los ID de origen y concilia los recuentos después de cada ejecución.

Añade pasadas independientes para los archivos, el texto enriquecido y las relaciones. No ejecutes una pasada de actualización sobre registros que los editores ya hayan modificado en Payload, a menos que se haya acordado qué sistema es la fuente de referencia. Las llamadas a la API local que omiten los controles de acceso tienen privilegios elevados; mantén el script y sus credenciales en un entorno controlado.

## Valida el contenido y el sitio web

Que un script se ejecute correctamente demuestra que se han escrito los registros, no que el sitio funcione. Compara los recuentos de origen y destino por tipo, idioma y estado de publicación. Investiga todas las diferencias, incluidos los registros excluidos deliberadamente. Comprueba si faltan campos obligatorios, hay slugs duplicados, referencias sin resolver o recursos que existen en la base de datos pero no se pueden servir.

Pide a los editores que revisen una muestra en el panel de administración de Payload. Incluye páginas complejas, no solo los artículos más recientes. Pídeles que abran vistas previas, editen una relación, sustituyan una imagen y verifiquen que sus roles les conceden el acceso previsto. Prueba la publicación y la retirada de contenido en el entorno de pruebas sin exponer públicamente contenido inacabado.

Después, compara las páginas renderizadas. Revisa los encabezados, enlaces, imágenes, datos estructurados, URL canónicas y metadatos frente al sitio existente. Confirma que las rutas antiguas siguen siendo válidas o cuentan con redirecciones previstas hacia el destino relevante más cercano. Nuestras [comprobaciones de SEO para sitios headless]({{site}}/blog/headless-seo-technical-checklist/) son útiles para revisar estos detalles del frontend antes del lanzamiento.

Mide el rendimiento en páginas representativas antes y después del cambio, utilizando las mismas condiciones de prueba siempre que sea posible. La elección del CMS por sí sola no determina la velocidad de las páginas: también importan las consultas, la caché, la entrega de imágenes y el código del frontend. Utiliza los [resultados de rendimiento headless de 2026]({{site}}/blog/headless-performance-benchmark-2026/) como referencia, no como sustituto de las pruebas de tu propio despliegue.

## Planifica la transición y la reversión

Documenta la secuencia, los responsables y los puntos de decisión antes del lanzamiento. Ensaya el proceso en el entorno de pruebas, incluido el tiempo necesario para la transferencia final de datos y la actualización de la caché. Una transición sencilla puede seguir estos pasos:

1. **Congela las ediciones en el origen.** Comunica a los editores cuándo Sanity pasará a ser de solo lectura y registra cualquier publicación programada que requiera un tratamiento especial.
2. **Realiza una exportación final.** Guarda una copia de seguridad y ejecuta las pasadas de importación acordadas, incluidas las de recursos y resolución de relaciones.
3. **Concilia los cambios.** Compara los recuentos y revisa los errores; después, confirma que el contenido aprobado más reciente está presente.
4. **Cambia la aplicación.** Despliega el frontend y la configuración que leen desde Payload, con los secretos de producción y los ajustes de almacenamiento preparados.
5. **Verifica las páginas públicas.** Prueba las rutas críticas, las redirecciones, las imágenes, los formularios, las vistas previas y la publicación junto con los responsables correspondientes.
6. **Levanta la congelación editorial.** Permite cambios en Payload solo cuando el equipo confirme que se han superado las comprobaciones de lanzamiento.

Mantén disponibles el despliegue anterior de la aplicación y el conjunto de datos de Sanity durante el período de reversión acordado. Define quién puede decidir una reversión y qué condiciones la activan. Volver a conectar el frontend anterior es solo una parte del trabajo: una vez que los editores publiquen cambios en Payload, esos cambios no existirán automáticamente en Sanity. Mantén congeladas las ediciones hasta tener suficiente confianza o documenta cómo capturar y volver a aplicar los cambios en caso de reversión.

Después del lanzamiento, supervisa las solicitudes fallidas, los recursos ausentes, los errores de redirección y los problemas de publicación. Da por cerrada la migración solo cuando los responsables editoriales hayan dado su aprobación y el equipo haya confirmado los procedimientos de copia de seguridad y restauración del nuevo entorno.
