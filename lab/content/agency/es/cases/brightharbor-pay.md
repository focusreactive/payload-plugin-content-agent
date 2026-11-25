title: Brightharbor Pay: una auditoría que redujo el tiempo de compilación a la mitad
summary: Brightharbor Pay recurrió a {{brand}} para investigar las compilaciones lentas y los incidentes recurrentes en su plataforma de publicación headless. La auditoría dio lugar a cambios específicos que agilizaron los lanzamientos y mejoraron la capacidad de respuesta del sitio.

## El cliente

Brightharbor Pay es una empresa sueca de tecnología financiera cuyo sitio web respalda su producto y le permite comunicarse con clientes potenciales. Su equipo de contenidos necesita publicar información precisa, fácil de mantener y disponible sin poner en riesgo los lanzamientos habituales.

El sitio utiliza [Strapi](https://strapi.io) para gestionar el contenido y [Next.js](https://nextjs.org) para renderizar el frontend. Esta separación da al equipo editorial control sobre el contenido y permite a los desarrolladores crear la experiencia en función de las necesidades del sitio. También exige que los modelos de contenido, las solicitudes a la API y el proceso de compilación funcionen de forma coordinada.

Brightharbor Pay solicitó a {{brand}} una auditoría y apoyo de cara a su lanzamiento de 2025. El objetivo no era reemplazar la plataforma, sino identificar las tareas que la ralentizaban y hacer que el sistema existente fuera más confiable.

## El desafío

El equipo había llegado a un punto en el que la publicación y el desarrollo requerían más esfuerzo del necesario. Los problemas aparecían en distintas etapas del flujo de trabajo, en lugar de concentrarse en un solo componente:

- Las compilaciones tardaban demasiado, lo que dificultaba lanzar cambios con confianza.
- Era necesario mejorar la capacidad de respuesta del sitio para los visitantes.
- Los incidentes recurrentes interrumpían al equipo y dificultaban distinguir los síntomas de sus causas.
- La entrega de contenido y los procesos de compilación del frontend necesitaban una revisión conjunta, en lugar de soluciones por separado.

Una compilación lenta afecta a más que la cola de despliegue. Alarga el ciclo de revisión de los desarrolladores y puede hacer que el equipo editorial tenga que esperar para ver publicado el contenido. Al mismo tiempo, los incidentes desvían la atención del trabajo planificado. Brightharbor Pay necesitaba una forma práctica de abordar ambos problemas sin interrumpir el trabajo diario del equipo de contenidos.

## El enfoque

{{brand}} organizó el proyecto en torno a una auditoría seguida de apoyo específico. El equipo examinó cómo llegaba el contenido desde Strapi al sitio de Next.js y utilizó los hallazgos para priorizar cambios que pudieran evaluarse en función de los objetivos del proyecto.

1. **Analizar el flujo de trabajo.** Revisar el proceso de compilación, las solicitudes de contenido y los patrones de incidentes para entender dónde se producían retrasos y dificultades operativas.
2. **Priorizar los hallazgos.** Separar los problemas que afectaban la velocidad de lanzamiento y la experiencia de usuario de los cambios que podían esperar, para concentrar los esfuerzos del equipo.
3. **Apoyar la implementación.** Trabajar con Brightharbor Pay en cambios a la plataforma existente y comprobar su efecto en las compilaciones, las interacciones y las operaciones diarias.
4. **Preparar la transferencia.** Documentar las decisiones y comprobaciones que el equipo del cliente necesitaría para mantener las mejoras después del lanzamiento.

La auditoría examinó la conexión entre el CMS y el frontend. Una solicitud de contenido que parece razonable por sí sola puede consumir muchos recursos si se repite durante una compilación. Del mismo modo, una mejora del frontend es más difícil de mantener si el equipo no puede ver cómo afecta al flujo de publicación.

## La solución

El trabajo se centró en reducir el procesamiento innecesario y facilitar la comprensión del proceso de entrega de contenido. El equipo revisó cómo el sitio solicitaba contenido, cómo esas solicitudes influían en las compilaciones y qué tareas del frontend podían ejecutarse de forma más eficiente.

Para los desarrolladores responsables de mantener la integración, la [referencia de la API REST]({{site}}/docs/reference/rest-api/) permitió contrastar el comportamiento de las solicitudes con la interfaz documentada. Esto hizo que la revisión fuera útil más allá del problema inmediato de compilación: los cambios futuros podrían evaluarse con una comprensión más clara de lo que el frontend solicita al CMS.

El trabajo en el frontend también abordó la capacidad de respuesta. En lugar de dar por resuelta la cuestión del rendimiento una vez que se cargaba la página, el equipo comprobó cómo se comportaba el sitio cuando los visitantes interactuaban con él. Interaction to Next Paint resultó una medida útil para evaluar esa parte de la experiencia.

El apoyo operativo fue parte de la solución desde el principio. {{brand}} trabajó con el equipo del cliente para establecer un proceso más sistemático de investigación de incidentes y mantener visibles las comprobaciones previas a cada lanzamiento. El objetivo era que Brightharbor Pay contara con un flujo de trabajo que su propio equipo pudiera gestionar, en lugar de un conjunto de cambios que dependieran de conocimientos externos.

## Los resultados

El trabajo de cara al lanzamiento produjo mejoras en la velocidad de compilación y la capacidad de respuesta, además de reducir los incidentes. El informe no proporcionó valores de referencia, por lo que la tabla recoge los resultados comunicados sin inventar una medición anterior.

| Métrica | Antes | Después |
|---|---|---|
| Tiempo de compilación | No proporcionado | Reducción del 52 % |
| Interaction to Next Paint | No proporcionado | 140 ms |
| Incidentes | No proporcionado | Reducción del 80 % |

El proceso de compilación más corto permitió al equipo pasar de un cambio a su lanzamiento con mayor rapidez. El resultado de interacción le dio a Brightharbor Pay una medida concreta de la capacidad de respuesta, mientras que la reducción de incidentes supuso menos interrupciones del trabajo planificado.

## Próximos pasos

Brightharbor Pay puede utilizar los hallazgos de la auditoría como referencia al agregar contenido o modificar el frontend. Comprobar el efecto de las nuevas solicitudes y componentes antes de cada lanzamiento ayudará al equipo a preservar las mejoras logradas durante el proyecto.

A medida que el sitio evolucione, también será necesario asignar responsabilidades claras para las redirecciones. La guía sobre [cómo gestionar las redirecciones durante una migración de CMS]({{site}}/blog/cms-redirects-at-scale/) ofrece un punto de partida útil para mantener ese trabajo en orden. El objetivo a largo plazo es sencillo: conservar un sistema de publicación que permita lanzamientos rápidos, responda con agilidad y sea fácil de gestionar para quienes lo operan.
