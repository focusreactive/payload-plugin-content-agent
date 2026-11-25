title: Colecciones de contenido de Astro o un CMS: cómo decidir
excerpt: Compara las colecciones de contenido de Astro con un CMS headless, desde los flujos editoriales y los tiempos de compilación hasta las vistas previas, la búsqueda y una ruta práctica de migración.
seoTitle: Colecciones de contenido de Astro vs. un CMS: guía práctica
seoDescription: Descubre cuándo bastan las colecciones de contenido de Astro, cuándo merece la pena un CMS headless y cómo combinarlos sin duplicar contenido.

[Astro](https://astro.build) permite crear un sitio con mucho contenido sin añadir una plataforma de publicación independiente. Las colecciones de contenido dan una estructura predecible a los archivos Markdown y MDX locales, mientras que un CMS headless como [Sanity](https://www.sanity.io) ofrece a los editores una interfaz dedicada y entrega el contenido a través de una API. Ninguna de las dos opciones es, por sí misma, más escalable o profesional. La decisión depende de quién publica, con qué frecuencia cambia el contenido y qué debe suceder antes de que un cambio llegue a los visitantes.

## Empieza por el flujo de publicación

Las colecciones de contenido son una buena opción cuando las personas que actualizan el sitio se sienten cómodas trabajando en un repositorio. Un desarrollador puede añadir un archivo Markdown, abrir un pull request y dejar que el flujo de despliegue compile el sitio actualizado. El contenido convive con el código, por lo que un cambio en una página y otro en el componente que la renderiza pueden revisarse juntos.

Ese flujo resulta menos cómodo cuando una persona responsable de una campaña necesita corregir un precio, alguien del equipo legal debe aprobar una afirmación y un traductor tiene que trabajar en otro idioma al mismo tiempo. La cuestión no es si esas personas *pueden* aprender Git, sino si el acceso al repositorio, los pull requests y la información sobre el despliegue son las herramientas adecuadas para su trabajo diario.

### Las colecciones de contenido son más que una carpeta

Las colecciones de Astro pueden cargar contenido local y validar sus campos con un esquema. Esto permite detectar datos ausentes o de tipo incorrecto antes de que lleguen a una página. Las colecciones también pueden cargar datos de otras fuentes, por lo que elegir una colección no implica necesariamente optar por archivos en lugar de un CMS.

La distinción importante es dónde realizan los editores el cambio oficial. Cuando el contenido se gestiona en un repositorio, la fuente de referencia suele ser un archivo en Git. Con un CMS, suele ser un registro que se mantiene en la interfaz editorial. Astro puede utilizar cualquiera de las dos fuentes y renderizar el resultado.

### Un CMS añade un sistema editorial

Un CMS headless separa la gestión del contenido de su presentación. Los editores trabajan con registros estructurados y recursos multimedia; el sitio solicita esos datos y decide cómo mostrarlos. Según el producto y su configuración, el equipo puede añadir funciones como roles editoriales, vistas previas, programación de publicaciones y flujos de aprobación.

Estas capacidades requieren configuración y mantenimiento continuo. Alguien debe diseñar los esquemas, gestionar los accesos, configurar las vistas previas y los despliegues, y mantener las integraciones en funcionamiento. Si el único cambio de contenido mensual consiste en que un desarrollador actualice una nota de versión, es posible que ese esfuerzo adicional no se justifique.

## Compara las opciones con el trabajo real

Usa la tabla como punto de partida, no como una evaluación en la que una columna deba ganar. Un sitio puede tener documentación gestionada en un repositorio y páginas de marketing gestionadas en un CMS.

| Criterio | Colecciones de contenido locales | CMS headless |
|---|---|---|
| Quién edita | Más adecuadas para personas familiarizadas con Git y la revisión de código | Adecuado para editores que necesitan una interfaz dedicada |
| Validación | La validación de esquemas de Astro se ejecuta como parte del flujo de desarrollo y compilación | Los modelos de contenido validan los registros en el CMS; aún pueden ser necesarias comprobaciones en el sitio |
| Publicación | Los cambios suelen pasar por un repositorio y un despliegue | La publicación puede activar una compilación o actualizar el contenido servido al recibir una solicitud |
| Colaboración | Los pull requests ofrecen revisión e historial de versiones | Los flujos editoriales y los permisos dependen del CMS y de su configuración |
| Costos y operación | No requiere un CMS independiente, pero el equipo mantiene el flujo de trabajo del repositorio | Añade costos de plataforma e integración, pero puede reducir la participación habitual de los desarrolladores |
| Reutilización | Otras herramientas pueden usar los archivos, con trabajo de integración | El contenido estructurado puede distribuirse a varios canales mediante API |

Considera el trabajo que rodea a una página, no solo la página en sí. Un equipo de producto pequeño podría mantener diez páginas de destino en Git sin dificultad. Un comercio con promociones frecuentes podría necesitar cambios programados, selección de recursos multimedia y aprobaciones, aunque tenga el mismo número de páginas.

El comercio electrónico añade otro límite: la disponibilidad y los precios de los productos pueden corresponder a una plataforma de comercio, en lugar del CMS o el repositorio de Astro. Nuestra comparativa de [opciones de comercio headless]({{site}}/blog/top-headless-commerce-platforms/) resulta útil cuando hay que elegir ese sistema por separado. Evita copiar datos de producto que cambian con frecuencia en campos editoriales, a menos que alguien se encargue de mantenerlos sincronizados.

> **Consejo práctico:** Traza el recorrido de un cambio de contenido reciente, desde la solicitud hasta la publicación. Cuenta las transferencias entre personas, aprobaciones y despliegues que requirió antes de decidir qué herramienta debería eliminar obstáculos.

## Crea una colección pequeña antes de decidirte

Un prototipo breve revela requisitos que una lista de funciones puede pasar por alto. En un proyecto de Astro que use la capa de contenido actual, crea `src/content.config.ts` y define una colección para publicaciones locales en Markdown:

```ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
```

El cargador encuentra los archivos Markdown del directorio indicado. El esquema exige un título, una descripción y una fecha de publicación, y asigna `false` cuando se omite el valor de `draft`. Una entrada no válida genera un error de validación en lugar de producir silenciosamente una página con datos ausentes.

Después puedes recuperar las entradas publicadas y ordenarlas por fecha:

```ts
import { getCollection } from "astro:content";

const posts = await getCollection("blog", ({ data }) => !data.draft);

posts.sort(
  (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf(),
);
```

Usa el resultado para generar páginas u otra consulta de contenido en el servidor. El filtro de borradores es una convención de publicación, no un mecanismo de control de acceso: mantén el material privado fuera de los repositorios públicos y asegúrate de excluir los borradores de todos los resultados que puedan exponerlos.

### Prueba también los casos menos favorables

Añade una publicación sin fecha y comprueba que la compilación informe del error. Después, prueba el flujo con alguien que vaya a publicar contenido: pídele que añada una imagen, proponga una edición y encuentre el resultado desplegado. Observa dónde necesita ayuda.

Prueba también cómo se encuentra el contenido. Astro puede generar páginas a partir de colecciones, pero un sitio grande puede necesitar un índice de búsqueda dedicado, ajustes de relevancia o filtros. Esos requisitos son independientes de la decisión de usar archivos locales o un CMS. Nuestra guía para [elegir entre dos motores de búsqueda]({{site}}/blog/algolia-vs-typesense/) analiza las ventajas y desventajas de esa parte de la arquitectura.

## Elige un CMS por las necesidades editoriales, no solo por la escala

Un CMS resulta especialmente útil cuando la publicación es una actividad recurrente del equipo y no una tarea de desarrollo ocasional. Busca señales en el flujo de trabajo:

- Los editores esperan con frecuencia a que los desarrolladores hagan cambios de contenido rutinarios.
- Varias personas necesitan revisar un cambio antes de que se publique.
- El contenido se reutiliza en distintas páginas, idiomas o canales y necesita una persona responsable claramente definida.
- Los autores necesitan seleccionar recursos multimedia y previsualizar los cambios en contexto.
- Los horarios de publicación no coinciden con la jornada de un desarrollador.

Estas señales no garantizan que un CMS en particular resuelva el problema sin configuración adicional. Comprueba qué flujos de trabajo admite el producto, el plan y la implementación que tienes previsto usar. Por ejemplo, un botón de vista previa solo es útil si muestra la versión no publicada de forma segura y precisa en el sitio.

### Define los límites del trabajo editorial

Antes de seleccionar los campos, acuerda qué controla un editor. Una página de destino podría tener un encabezado, un resumen, llamadas a la acción y un conjunto ordenado de bloques de contenido aprobados. Los desarrolladores siguen siendo responsables de los componentes, el comportamiento de accesibilidad y las reglas que mantienen la coherencia de esos bloques.

Modela las entidades reutilizables por separado cuando realmente tengan ciclos de vida independientes. Un perfil de autor que se usa en muchos artículos es un buen ejemplo de registro compartido. Un párrafo que se usa una sola vez probablemente no necesite su propio tipo de contenido. Demasiadas referencias dificultan las ediciones sencillas; muy pocas favorecen la creación de copias inconsistentes.

Los permisos también importan. Decide quién puede crear borradores, aprobar, publicar y modificar esquemas. Mantén las credenciales de la API en el servidor, concede el acceso mínimo necesario y distingue entre la entrega de contenido público y el acceso a borradores.

## Combina Astro y un CMS con un propósito claro

Los dos enfoques funcionan bien juntos cuando cada uno tiene una función definida. Mantén en el repositorio el material a cargo de los desarrolladores, como la documentación técnica estrechamente vinculada a las versiones. Guarda en el CMS el contenido de marketing que se actualiza con frecuencia si los editores necesitan publicarlo de forma independiente. Astro puede consultar el CMS directamente o usar un cargador de colecciones adecuado para incorporar datos externos a su capa de contenido.

### Decide cuándo se obtienen los datos

Una página generada estáticamente obtiene su contenido durante la compilación. Los visitantes reciben una versión generada de antemano, que puede ser eficiente y sencilla de alojar. La contrapartida es que un cambio publicado en el CMS no es visible hasta que se vuelve a compilar y desplegar la parte afectada del sitio.

Una página renderizada bajo demanda puede obtener contenido cuando llega una solicitud, según la configuración del alojamiento y la estrategia de caché. Esto puede acortar el tiempo entre la publicación y su visibilidad, pero introduce dependencias en tiempo de ejecución y requiere un adaptador y un entorno de alojamiento compatibles. Decide qué sucederá si la API del CMS responde lentamente o no está disponible.

En ambos modelos, diseña explícitamente el almacenamiento en caché y su invalidación. Un webhook puede iniciar un despliegue después de la publicación, pero debe estar autenticado y protegido frente a compilaciones repetidas innecesarias. La vista previa debe acceder a los borradores desde el servidor, evitar las cachés públicas compartidas y mantenerse separada del sitio publicado.

### Mantén una sola fuente de referencia por campo

No permitas que un título pueda editarse de forma independiente tanto en un archivo Markdown como en el CMS. Si una página combina fuentes, documenta qué sistema es responsable de cada campo y cómo se resuelven los conflictos. Lo mismo se aplica a las imágenes, las redirecciones, los slugs y los textos traducidos.

Una migración también es una oportunidad para revisar los aspectos operativos que rodean al modelo de contenido: acceso a las vistas previas, despliegue, redirecciones y recuperación. Nuestro trabajo en [desarrollo de CMS headless]({{site}}/headless-cms-development/) aborda esas decisiones de integración, además de la interfaz editorial.

## Planifica la decisión y mide el resultado

Haz la comparación con una parte representativa del sitio en lugar de migrarlo todo a la vez. Elige un tipo de página con una complejidad editorial real, pero no la página más excepcional de todo el sitio.

1. **Documenta el flujo actual.** Registra quién solicita, redacta, revisa, publica y corrige un cambio habitual.
2. **Crea un prototipo de ambas opciones.** Construye el mismo tipo de página con una colección local y con un modelo basado en un CMS. Incluye una imagen, un borrador y un campo reutilizable.
3. **Prueba con el equipo de publicación.** Pide a los editores que completen una tarea realista sin que un desarrollador dirija el proceso. Anota dónde los permisos, la terminología o el comportamiento de la vista previa generan confusión.
4. **Mide la entrega.** Registra el tiempo de compilación y despliegue, el tiempo desde la aprobación hasta que el cambio es visible y los pasos necesarios para revertir un error.
5. **Define responsables y despliegue.** Asigna una fuente de referencia a cada tipo de contenido, migra un conjunto limitado, comprueba las redirecciones y los metadatos, y amplía la migración solo cuando el flujo funcione.

El tiempo de compilación merece atención, pero no debe considerarse por sí solo una razón para contratar un CMS. Un sitio estático alimentado por un CMS sigue necesitando una nueva compilación si así se generan sus páginas. Primero averigua qué hace el proceso de compilación y qué parte es lenta. En [la auditoría de Brightharbor Pay]({{site}}/case-studies/brightharbor-pay/), el tiempo de compilación se redujo a la mitad; la lección es investigar el proceso real en lugar de asumir que la fuente de contenido es el cuello de botella.

Por último, calcula el costo del flujo de trabajo a lo largo del tiempo. Incluye las tarifas de la plataforma cuando correspondan, la implementación, el mantenimiento, la capacitación de los editores y el tiempo que dedican los desarrolladores a las actualizaciones rutinarias. Un sitio basado en archivos no requiere una suscripción independiente a un CMS, pero su operación no es gratuita. Un CMS tiene costos de integración, pero puede reducir la dependencia del equipo de desarrollo para publicar con frecuencia.
