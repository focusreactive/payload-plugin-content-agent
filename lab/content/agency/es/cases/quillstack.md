title: Quillstack: un sitio de marketing que lanza una landing page al día
summary: El sitio de marketing de Quillstack para 2026 ofrece a su equipo un sistema reutilizable para diseñar, publicar y mantener landing pages. {{brand}} se encargó del diseño y el desarrollo; se reportaron 140 páginas lanzadas y una velocidad de publicación de 6 x.

## El cliente

Quillstack es una empresa de software como servicio con sede en los Países Bajos. Su equipo de marketing utiliza landing pages para dirigirse a distintos públicos, presentar las funcionalidades del producto y convertir el interés en solicitudes de demostración.

La empresa necesitaba un sitio capaz de seguir el ritmo de sus campañas sin convertir cada página nueva en un proyecto de desarrollo. Para su lanzamiento de 2026, Quillstack recurrió a {{brand}} tanto para el diseño como para el desarrollo. El objetivo era proporcionar al equipo de marketing un sistema de publicación que ofreciera una experiencia coherente a los visitantes y flexibilidad a quienes creaban las páginas.

## El desafío

Las ideas para las campañas de Quillstack avanzaban más rápido que su proceso de publicación. Una landing page solía comenzar como una solicitud sencilla, pero terminaba implicando numerosas decisiones de diseño, cambios de contenido y gestiones con el equipo de desarrollo. Esto dificultaba la respuesta a una nueva campaña sin interrumpir otros trabajos.

El equipo necesitaba resolver varios problemas relacionados:

- Los editores carecían de un conjunto fiable de componentes para crear páginas de campaña.
- La creación de páginas dependía de los desarrolladores para realizar cambios habituales de diseño y contenido.
- Las páginas similares podían perder coherencia visual a medida que evolucionaban las campañas.
- Los metadatos para buscadores debían atenderse junto con el contenido, en lugar de después de la publicación.
- Los equipos de marketing y desarrollo necesitaban una forma más clara de revisar una página antes de publicarla.

La solución no podía ser una única plantilla fija. Quillstack necesitaba suficiente variedad para adaptar cada campaña a su público, sin perder una identidad visual reconocible ni dificultar el mantenimiento del sitio.

## El enfoque

{{brand}} organizó el trabajo en torno a las tareas de publicación que debía realizar el equipo de marketing, desde la creación de una página hasta su revisión antes del lanzamiento.

1. **Definir el contenido.** El equipo identificó los elementos recurrentes de una landing page, como las introducciones, las explicaciones de funcionalidades, los elementos que aportan credibilidad y las llamadas a solicitar una demostración. Así determinó qué debía ser reutilizable y dónde necesitaban los editores margen para adaptar el contenido.
2. **Diseñar el sistema.** Los diseñadores crearon un conjunto de componentes de página con tipografía, espaciado y comportamiento adaptable coherentes. También estudiaron cómo combinarlos sin que todas las páginas parecieran idénticas.
3. **Crear el flujo de trabajo.** Los desarrolladores implementaron el modelo de contenido en [Payload](https://payloadcms.com), crearon el frontend con [Next.js](https://nextjs.org) y desplegaron el sitio en [Vercel](https://vercel.com).
4. **Revisar y perfeccionar.** El equipo probó con Quillstack la creación de páginas, la revisión editorial y las tareas de lanzamiento. Después ajustó los componentes y campos para facilitar su uso cotidiano.

Esta secuencia mantuvo las decisiones de diseño y tecnología alineadas con el uso real que Quillstack daría al sitio. También permitió al cliente participar en la evaluación del sistema antes de utilizarlo para sus campañas.

## La solución

El sitio final ofrece a Quillstack una colección estructurada de bloques de contenido en lugar de un lienzo en blanco. Un editor puede elegir los componentes que necesita una campaña, redactar los textos y organizar la página dentro del sistema visual. Los estilos compartidos se aplican en todas las páginas, de modo que una nueva campaña no requiere un diseño desde cero para cada sección.

Payload almacena el contenido y proporciona la interfaz de edición. Next.js genera el sitio, mientras que Vercel permite desplegarlo. La separación entre contenido y presentación permite al equipo actualizar los materiales de marketing sin convertir cada cambio de texto en una tarea de desarrollo del frontend.

El modelo de contenido también incluye los metadatos para buscadores como parte del flujo de publicación. Los editores pueden definir el título y la descripción de una página mientras la preparan, en lugar de dejar esa tarea para el lanzamiento. Para los equipos que quieran establecer un proceso similar, {{brand}} documenta [cómo gestionar los metadatos SEO]({{site}}/docs/guides/seo-metadata/) en {{short}} Starter.

La revisión sigue formando parte del proceso. Los componentes reutilizables reducen el número de decisiones necesarias para cada campaña, pero no sustituyen la comprobación de los textos, los enlaces y la llamada a la acción. El sistema ofrece a marketing una vía más directa para publicar, sin perder una instancia clara en la que otros miembros del equipo pueden evaluar la página.

El proyecto consistió en la creación de un sitio nuevo, no en una migración desde otra plataforma concreta. Para las organizaciones que evalúan un cambio de CMS, {{brand}} también explica [cómo planificar una migración de Sanity a Payload]({{site}}/blog/sanity-to-payload-migration-guide/).

## Los resultados

El proyecto hizo seguimiento de la producción de landing pages, la velocidad de publicación y las solicitudes de demostración. A continuación se muestran los resultados reportados; no se registraron los valores iniciales ni la base de cálculo del porcentaje de solicitudes de demostración.

| Indicador | Antes | Después |
|---|---|---|
| Landing pages lanzadas | No registrado | 140 páginas |
| Velocidad de publicación | No registrado | 6 x |
| Solicitudes de demostración | No registrado | 35 % |

> «Podemos crear una campaña con componentes en los que confiamos y dedicar el tiempo de revisión al mensaje, en lugar de volver a construir la página».
>
> Mara de Vries, directora de marketing, Quillstack

## Próximos pasos

Quillstack puede seguir desarrollando campañas con el conjunto de componentes existente y ampliarlo cuando surja una necesidad real de contenido. Así, el equipo puede mantener la coherencia del sitio sin considerar que el diseño del lanzamiento deba permanecer inalterado para siempre.

A medida que se acumulan las páginas, la tarea editorial pasa de crearlas a mantenerlas útiles. Revisar los textos, las llamadas a la acción y los metadatos de campañas anteriores ayudará a Quillstack a mantener la biblioteca que ha creado y a tomar decisiones fundamentadas sobre qué actualizar a continuación.
