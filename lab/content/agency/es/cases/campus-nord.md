title: Campus Nord: un sitio universitario renovado para dos idiomas
summary: Campus Nord renovó su sitio web universitario con una plataforma de contenidos headless y un frontend más rápido. La migración integró sus páginas en un flujo de trabajo editorial compartido, diseñado para lectores de dos idiomas.

## El cliente

Campus Nord es una universidad austríaca que atiende a futuros estudiantes, estudiantes actuales y a la comunidad académica en general. Su sitio web es un punto de partida para explorar los programas, conocer los requisitos de admisión y encontrar información práctica sobre la vida universitaria.

La universidad necesitaba que el sitio funcionara en dos idiomas, sin que ninguno quedara en segundo plano. También necesitaba un sistema editorial que permitiera al personal mantener actualizada la información de los programas y publicar novedades sin depender de un desarrollador para los cambios habituales.

Campus Nord trabajó con {{brand}} en un proyecto de migración y localización que sustituyó su sistema de publicación anterior y culminó con el lanzamiento del nuevo sitio en 2026.

## El desafío

El sitio anterior de la universidad funcionaba con [WordPress](https://wordpress.org). Con el tiempo, su contenido se había acumulado en secciones dirigidas a distintos públicos y con diferentes propósitos. Trasladar ese material no consistía simplemente en copiar páginas a otro sistema: el equipo debía decidir cómo se organizaría y mantendría el contenido después de la migración.

El proyecto presentaba varios desafíos relacionados entre sí:

- La información sobre programas y admisiones necesitaba una estructura coherente para que los visitantes pudieran encontrar los datos relevantes en todo el sitio.
- Era necesario establecer una relación fácil de gestionar entre los contenidos de ambos idiomas, en lugar de mantenerlos como conjuntos de páginas independientes.
- Los editores necesitaban una forma clara de actualizar el contenido sin tener que ocuparse de su presentación.
- La migración debía conservar el material útil y, al mismo tiempo, dar a la universidad la oportunidad de revisarlo.
- Era necesario mejorar la velocidad de carga de las páginas, sobre todo en los recorridos en los que los futuros estudiantes pasan de la información sobre programas a la de postulación.

La cuestión central era cómo dar a los editores más control y, al mismo tiempo, hacer que el sitio publicado fuera más fácil de usar para los visitantes.

## El enfoque

{{brand}} organizó el trabajo en torno al contenido, el flujo editorial y la experiencia de los visitantes. En lugar de centrarse únicamente en un rediseño visual, el equipo examinó cómo debían adaptarse las páginas existentes al nuevo sistema.

1. **Revisión y mapeo del contenido.** El equipo revisó el contenido de WordPress y lo relacionó con los tipos de información que debía admitir el nuevo sitio. Esto permitió definir dónde correspondían los detalles de los programas, la información general de la universidad y el contenido sobre admisiones.
2. **Planificación de la localización.** El equipo definió cómo se representarían y mantendrían las versiones en cada idioma. El objetivo era facilitar que los editores vieran los contenidos relacionados e identificaran lo que necesitaba atención antes de la publicación.
3. **Migración e implementación.** El contenido se trasladó a la nueva plataforma, se comprobó que siguiera la estructura acordada y se conectó al frontend. El equipo revisó los resultados con Campus Nord, en lugar de dar la migración por terminada tras la importación.
4. **Preparación del lanzamiento.** La universidad y {{brand}} comprobaron los recorridos clave, las versiones en cada idioma y las tareas editoriales antes del lanzamiento en 2026.

Este enfoque dio a la universidad la oportunidad de examinar su contenido durante la transición técnica. También convirtió la migración en una base para la publicación continua, no solo en un traslado de una base de datos antigua a una nueva.

## La solución

La nueva plataforma de contenidos utiliza [Sanity](https://www.sanity.io), con un modelo diseñado para las necesidades de publicación de la universidad. Los editores pueden trabajar con contenido estructurado en lugar de crear cada página como un diseño independiente. Esto es importante cuando información similar debe aparecer de forma coherente en las páginas de los programas y en ambos idiomas.

La localización forma parte del flujo de trabajo de contenidos. Los editores pueden trabajar en las versiones en cada idioma teniendo presente cómo se relacionan, al tiempo que revisan la información que verá cada público. El modelo responde a la necesidad de la universidad de mantener el sitio después del lanzamiento, cuando los detalles de admisión y la información de los programas siguen cambiando.

El frontend utiliza [Astro](https://astro.build), un framework que puede generar páginas estáticas y limitar el JavaScript que se envía al navegador. Ofrece una forma adecuada de presentar el contenido de la plataforma headless, manteniendo la experiencia del sitio centrada en la lectura y la navegación. Para conocer mejor los criterios de selección de herramientas para el frontend, la comparación de [generadores de sitios estáticos]({{site}}/blog/best-static-site-generators-2026/) de {{brand}} analiza las ventajas y limitaciones de las opciones disponibles.

La separación entre la gestión de contenidos y la presentación también permite a Campus Nord distribuir las responsabilidades con mayor claridad. Los editores mantienen la información; el frontend determina cómo se presenta. El proyecto refleja las tendencias de publicación más amplias que {{brand}} analiza en su artículo sobre [el panorama de los CMS headless]({{site}}/blog/state-of-headless-cms-2026/).

> El nuevo sitio de Campus Nord integra sus flujos de contenido y de gestión de idiomas en un sistema de publicación compartido.

## Los resultados

La migración trasladó el contenido de la universidad al nuevo entorno y dio a Campus Nord una base para gestionar el sitio en ambos idiomas. Los resultados reportados son:

| Indicador | Antes | Después |
|---|---|---|
| Páginas migradas | — | 3600 páginas |
| Mejora en la velocidad de carga | — | 71 % |
| Postulaciones | — | 14 % |

La cifra de postulaciones se reporta sin un valor de referencia y no debe interpretarse como un número absoluto de postulaciones. Más allá de las cifras, la nueva estructura ofrece a la universidad una forma más coherente de mantener la información que necesitan los futuros estudiantes.

## Próximos pasos

El lanzamiento estableció un sistema de publicación que Campus Nord puede seguir utilizando a medida que cambia su contenido. El trabajo continuo es editorial: mantener actualizada la información sobre programas y admisiones, revisar las versiones en cada idioma y asegurarse de que los visitantes puedan pasar de la búsqueda de información a la postulación con confianza.

Como el contenido y la presentación están separados, la universidad puede perfeccionar cualquiera de las dos partes sin tener que reconstruir todo el sitio por cada cambio. Esto da a su equipo margen para mejorar la experiencia y mantener la estructura compartida creada durante la migración.
