title: Alpenroute Travel: un planificador de viajes en tres idiomas
summary: Alpenroute Travel lanzó en 2025 un planificador de viajes multilingüe, desarrollado y localizado por {{brand}}. El proyecto utilizó Sanity y Astro para conectar el contenido sobre destinos con las solicitudes de reserva en tres idiomas.

## El cliente

Alpenroute Travel es una empresa suiza que ayuda a los viajeros a planificar sus viajes. Su proyecto de 2025 con {{brand}} se centró en un planificador de viajes: un espacio donde los visitantes pudieran explorar información en su idioma preferido y avanzar hacia una solicitud de reserva.

La empresa necesitaba que la experiencia respondiera tanto a las necesidades de los viajeros como a las de los responsables de mantener el contenido. La información sobre destinos, las recomendaciones de planificación y las opciones para solicitar una reserva debían funcionar de forma integrada, sin que los editores tuvieran que gestionar sitios web independientes para cada idioma.

## El desafío

La planificación de un viaje suele comenzar con una exploración, antes de tomar una decisión definitiva. Alpenroute Travel necesitaba facilitar esa búsqueda inicial y, al mismo tiempo, mantener claro el camino hacia una consulta. El equipo también debía lograr que el contenido localizado fuera fácil de gestionar después del lanzamiento.

Los principales desafíos eran:

- Los viajeros necesitaban una experiencia de planificación coherente en los tres idiomas.
- Los editores necesitaban una forma de mantener el contenido sobre destinos y sus traducciones sin duplicar un sitio completo.
- Las opciones para solicitar una reserva debían integrarse de forma natural en el proceso de planificación.
- El sitio debía ofrecer contenido útil con rapidez, incluso con conexiones móviles.

El trabajo exigía algo más que traducir el texto visible. La navegación, las relaciones entre páginas y las llamadas a la acción debían seguir siendo claras cuando los visitantes pasaran de una página localizada a otra. El modelo de contenido también debía distinguir el material compartido entre idiomas de los textos que los editores adaptarían.

## El enfoque

{{brand}} desarrolló y localizó el proyecto por fases, integrando la estructura de contenido y el frontend en torno al proceso de planificación del viaje.

1. **Definir el recorrido.** El equipo organizó la experiencia en torno al descubrimiento de destinos, la consulta de información relevante y el envío de una solicitud de reserva. Así se definió dónde debían aparecer las indicaciones localizadas y las opciones de reserva.
2. **Modelar el contenido.** El contenido sobre destinos y los textos de la interfaz se estructuraron para su edición en [Sanity](https://www.sanity.io). Las variantes de idioma pasaron a formar parte del flujo de publicación, en lugar de gestionarse como sitios independientes y desconectados.
3. **Desarrollar el frontend.** El planificador se desarrolló con [Astro](https://astro.build), utilizando el contenido estructurado para generar páginas localizadas y conectarlas con el proceso de consulta.
4. **Revisar y lanzar.** El equipo revisó conjuntamente las variantes de idioma, la navegación y los recorridos de reserva, y después preparó el sitio para su lanzamiento en 2025.

{{brand}} también mantiene {{short}} Starter, un proyecto de código abierto para Next.js y un CMS headless. Su [guía para organizar un proyecto inicial]({{site}}/docs/getting-started/project-structure/) y su [referencia de hooks del proyecto inicial]({{site}}/docs/reference/hooks/) son recursos para esa configuración independiente. El frontend de Alpenroute se desarrolló con Astro, no con el proyecto inicial de Next.js.

## La solución

El planificador reúne en una misma experiencia el contenido sobre destinos, la navegación localizada y las solicitudes de reserva. Los visitantes pueden consultar información para planificar su viaje en uno de los idiomas disponibles y avanzar hacia una consulta sin tener que pasar a un entorno ajeno al recorrido.

Sanity ofrece al equipo de contenido un entorno de edición estructurado. Los editores pueden trabajar en la información sobre destinos y sus variantes de idioma en el mismo sistema, lo que facilita el mantenimiento de las relaciones entre páginas. El modelo también separa el contenido editorial de la presentación en el frontend, de modo que los cambios en los textos de viaje no requieren modificar los diseños de página.

Astro se encarga de las páginas visibles para el público. Su enfoque de desarrollo web permite al equipo ofrecer páginas centradas en el contenido y añadir interactividad donde la experiencia de planificación lo necesita. La implementación mantiene visible el siguiente paso para el viajero: la información útil conduce hacia una solicitud de reserva, en lugar de terminar en una descripción del destino.

La localización formó parte del desarrollo desde el principio; no fue una revisión final de un sitio ya terminado en inglés. El equipo consideró cómo funcionarían la navegación, las etiquetas y las llamadas a la acción en los idiomas disponibles. Esto permitió revisar recorridos completos, en lugar de comprobar los textos traducidos de forma aislada.

> Conclusión editorial: Un planificador de viajes funciona mejor cuando los viajeros pueden pasar de la información sobre destinos a una consulta sin cambiar de idioma ni perder su lugar en el recorrido.

Alpenroute Travel — cliente

## Los resultados

El proyecto se lanzó en 2025. A continuación se muestran los resultados facilitados; no se proporcionaron valores anteriores comparables.

| Indicador | Antes | Después |
|---|---|---|
| Solicitudes de reserva | No proporcionado | 27 % |
| Largest Contentful Paint | No proporcionado | 1100 ms |
| Tiempo hasta el lanzamiento | No proporcionado | 3 meses |

La cifra de solicitudes de reserva se presenta tal como fue facilitada, sin asumir una referencia inicial ni interpretarla como un aumento. Largest Contentful Paint refleja el rendimiento de carga comunicado, mientras que la cifra de lanzamiento indica el tiempo que se tardó en poner el proyecto en marcha.

El proyecto también proporcionó a Alpenroute Travel una estructura de contenido diseñada para su uso continuado después del lanzamiento. Su equipo puede mantener en Sanity la información que consultan los viajeros, mientras el frontend de Astro presenta ese contenido como una experiencia de planificación localizada.

## Próximos pasos

La siguiente etapa consiste en mantener actualizadas la información sobre destinos y las traducciones a medida que cambien las ofertas de viaje. Los editores pueden revisar cada recorrido localizado junto con su opción de reserva, para comprobar que el contenido siga ofreciendo a los viajeros lo que necesitan antes de realizar una consulta.

La separación entre contenido y presentación sienta las bases para ese trabajo continuo. Alpenroute Travel puede actualizar la información de planificación en el CMS y, al mismo tiempo, mantener una experiencia coherente en el frontend para todos los idiomas disponibles.
