title: Benchmark de rendimiento headless 2026: medición de 60 sitios
excerpt: Un benchmark de laboratorio realizado en 2026 analiza la velocidad de carga, la estabilidad del diseño y el peso de las imágenes de 60 sitios headless, con recomendaciones prácticas para equipos que planifican su próximo lanzamiento.
seoTitle: Benchmark de rendimiento headless 2026: 60 sitios evaluados
seoDescription: Descubre el rendimiento de 60 sitios headless en un benchmark móvil de laboratorio realizado en 2026, con datos sobre velocidad de carga, peso de imágenes y prioridades de mejora.

Soy Mara Lindqvist, directora de Ingeniería de {{brand}}. Para este informe medimos 60 sitios headless con el fin de analizar cómo variaba el rendimiento móvil según el tipo de página y las decisiones de implementación. Los resultados apuntan a una conclusión conocida: una arquitectura headless ofrece margen para optimizar, pero no hace que las páginas sean rápidas por sí sola.

## Hallazgos principales

1. El sitio mediano registró un Largest Contentful Paint, o LCP, de 2.3 segundos en las páginas evaluadas. El cuartil más lento comenzó en 3.4 segundos.
2. Cuarenta y dos de los 60 sitios cumplieron nuestros tres umbrales de laboratorio para LCP, Cumulative Layout Shift y Total Blocking Time. Es un resultado del benchmark, no una tasa de aprobación de Core Web Vitals con usuarios reales.
3. Los sitios que transfirieron menos datos de imágenes generalmente obtuvieron mejores resultados. Once de los 12 sitios del grupo con menor peso de imágenes cumplieron los tres umbrales, frente a dos de los ocho del grupo con mayor peso.
4. Los resultados variaron dentro de cada grupo de framework. El framework por sí solo no explicó si un sitio cumplía los umbrales.
5. El siguiente paso más útil es medir plantillas de página representativas y después abordar los recursos y las decisiones de diseño responsables de sus demoras específicas.

## Metodología

Seleccionamos 60 sitios headless de acceso público y asignamos cada uno a una categoría principal: comercio, editorial, corporativo, servicios o sin fines de lucro. La muestra no fue aleatoria y no debe considerarse representativa de todos los sitios headless. Las categorías describen el propósito principal de cada sitio, incluso cuando también publica artículos o vende productos.

La muestra incluyó 24 sitios creados con [Next.js](https://nextjs.org), 20 con [Astro](https://astro.build) y 16 con [Nuxt](https://nuxt.com). Elegimos sitios cuyo framework frontend se podía identificar y evaluamos la página de inicio y dos páginas internas representativas de cada uno. Para las 180 URL, realizamos cinco auditorías móviles de Lighthouse por URL con carga en frío, para un total de 900 auditorías.

Para cada métrica, calculamos la mediana de las cinco ejecuciones de cada URL y luego la mediana de los valores de las tres URL de cada sitio. Las cifras de los grupos son las medianas de esos valores por sitio. Este enfoque da el mismo peso a cada sitio, independientemente de cuántas páginas publique. La cifra de 3.4 segundos corresponde al percentil 75 de los 60 valores de LCP a nivel de sitio.

Para cumplir el umbral combinado de laboratorio, cada sitio debía tener un LCP de no más de 2.5 segundos, un Cumulative Layout Shift, o CLS, de no más de 0.10 y un Total Blocking Time, o TBT, de no más de 200 milisegundos. Los umbrales de LCP y CLS siguen los límites comúnmente utilizados para considerar buenos los resultados de Core Web Vitals. El TBT es una métrica de diagnóstico de laboratorio; no sustituye la medición de Interaction to Next Paint, o INP, con usuarios reales.

El peso de las imágenes corresponde a los bytes de imágenes transferidos y registrados durante cada auditoría, resumidos de la misma manera que las demás métricas. Las pruebas utilizaron un perfil uniforme de emulación móvil y limitación de recursos. No incluyeron visitas recurrentes, estados personalizados ni interacciones posteriores a la carga inicial de la página.

## Los resultados de referencia varían según la categoría del sitio

La mediana general de LCP fue de 2.3 segundos. Está dentro del límite considerado bueno para LCP, pero eso no significa que todas las páginas del sitio mediano fueran rápidas: cada valor por sitio resume tres páginas y el rendimiento de cada ruta puede ser distinto.

| Categoría del sitio | Sitios | Mediana de LCP | Mediana de CLS | Sitios que cumplen todos los umbrales |
|---|---:|---:|---:|---:|
| Comercio | 16 | 2.7 s | 0.08 | 10 |
| Editorial | 14 | 2.2 s | 0.05 | 10 |
| Corporativo | 12 | 2.1 s | 0.04 | 9 |
| Servicios | 10 | 2.4 s | 0.06 | 7 |
| Sin fines de lucro | 8 | 2.3 s | 0.05 | 6 |
| Todos los sitios | 60 | 2.3 s | 0.05 | 42 |

El grupo de comercio tuvo la mediana de LCP más alta de esta muestra. Las imágenes de productos, los componentes de presentación comercial y los scripts de terceros son puntos razonables para investigar, pero las cifras por categoría no permiten determinar qué recurso causó una demora en un sitio concreto. La tabla tampoco compara plataformas de comercio: la elección de plataforma y la implementación del frontend son decisiones distintas.

Para los equipos que evalúan estas decisiones, nuestra comparación de [opciones de comercio headless](#) no sería el recurso adecuado a menos que el enlace lleve a la comparación real. En su lugar, consulta las [diferencias entre Shopify y Medusa para proyectos headless]({{site}}/blog/shopify-vs-medusa-headless/) y luego evalúa las plantillas de página y las integraciones que planeas lanzar.

## El peso de las imágenes muestra una relación visible con el cumplimiento de los umbrales

Agrupamos los sitios según la mediana de transferencia de imágenes a nivel de sitio. Los rangos son descriptivos, no presupuestos recomendados: una página con muchas imágenes puede mostrar su contenido principal rápidamente, y una página ligera puede verse demorada por fuentes, scripts o la respuesta del servidor.

| Mediana de transferencia de imágenes por sitio | Sitios | Mediana de LCP | Mediana de TBT | Sitios que cumplen todos los umbrales |
|---|---:|---:|---:|---:|
| Menos de 250 KB | 12 | 1.7 s | 90 ms | 11 |
| 250–499 KB | 14 | 1.9 s | 120 ms | 12 |
| 500–999 KB | 16 | 2.3 s | 160 ms | 11 |
| 1,000–1,999 KB | 10 | 2.8 s | 230 ms | 6 |
| 2,000 KB o más | 8 | 3.5 s | 310 ms | 2 |
| Todos los sitios | 60 | 2.3 s | 160 ms | 42 |

Este patrón es útil para establecer prioridades, pero no demuestra que el peso de las imágenes por sí solo haya causado las diferencias. Las páginas más pesadas también pueden tener más scripts, componentes o solicitudes a terceros. No mantuvimos constantes esas variables.

Comienza por la imagen que parece ser el elemento LCP en una ruta lenta. Compara sus dimensiones de visualización con las del archivo que se entrega en dispositivos móviles, asegúrate de que el navegador pueda detectarla rápidamente y evita la carga diferida si se necesita de inmediato. Después, revisa por separado las imágenes situadas más abajo en la página. Reducir la transferencia total de imágenes es valioso, pero un total menor no garantiza un LCP más rápido.

Los modelos de contenido pueden ayudar a los equipos a aplicar estas comprobaciones de manera uniforme. El enfoque descrito en [este proyecto de 40 sitios para clínicas]({{site}}/case-studies/sundari-clinics/) muestra por qué son importantes las estructuras de contenido compartidas cuando muchos sitios necesitan gestionar los mismos tipos de contenido de página.

## La elección del framework no garantiza el rendimiento

La muestra incluye tres frameworks, pero no constituye una comparación controlada entre ellos. Los grupos difieren en tamaño, propósito de los sitios, diseño, alojamiento e integraciones. Una clasificación basada en sus resultados brutos correría el riesgo de atribuir esas diferencias al propio framework.

Cada framework admite enfoques que pueden dar lugar a páginas rápidas. Las preguntas relevantes son qué se renderiza en el servidor o durante la compilación, cuánto JavaScript llega al navegador, cuándo se hace visible el contenido y qué recursos compiten por la red. Estas decisiones pueden variar considerablemente entre dos proyectos que utilizan el mismo framework.

Mide el resultado en producción en lugar de dar por hecho que una función del framework está activa o es suficiente. Una página mayormente estática aún puede cargar un gran árbol de componentes en el cliente. Una página renderizada en el servidor aún puede esperar una solicitud lenta a un servicio externo. En ambos casos puede haber desplazamientos visibles si no se reserva espacio para una imagen, contenido incrustado o un banner.

{{short}} Starter es nuestro kit de inicio de código abierto para Next.js y un CMS headless. La versión actual es 3.2, y los equipos pueden instalarla con `npx create-headless-starter`. Los usuarios que actualicen desde 2.x pueden consultar [la guía de actualización]({{site}}/docs/guides/upgrading-to-3/); una actualización también es una buena oportunidad para repetir las mismas pruebas de página antes y después del despliegue.

## El tiempo de bloqueo y la estabilidad del diseño necesitan comprobaciones propias

El LCP recibe atención porque describe cuándo se muestra el contenido principal visible, pero es solo una parte de la experiencia. Una página puede mostrar su título rápidamente y aun así ser difícil de usar mientras JavaScript ocupa el hilo principal. También puede desplazarse después de mostrarse, haciendo que un visitante pulse el control equivocado.

En este benchmark, para aprobar era necesario cumplir los tres umbrales de laboratorio. Por lo tanto, un sitio con un buen LCP podía no superar la prueba combinada debido al CLS o al TBT. A la inversa, un sitio que supera estas comprobaciones de laboratorio aún puede tener un INP deficiente para visitantes reales, especialmente en dispositivos más lentos o durante interacciones que no probamos.

Investiga los scripts según su propósito, no solo por el tamaño del archivo. Pregunta si una función debe ejecutarse antes de que un visitante pueda usar la página, si puede esperar hasta que sea necesaria y si una integración de terceros aporta suficiente valor para justificar su costo. Para los desplazamientos de diseño, revisa las fuentes que cargan tarde, las imágenes sin dimensiones reservadas y los elementos insertados por encima del contenido existente.

Una revisión útil antes del lanzamiento incluye:

- Una auditoría móvil repetible de la página de inicio y de las plantillas internas importantes.
- Una comparación con la versión anterior bajo las mismas condiciones de prueba.
- Una revisión independiente del LCP, CLS e INP de usuarios reales cuando haya datos de campo disponibles.
- Una persona responsable de cada regresión y una decisión sobre si impide el lanzamiento.

## Qué significa para tu próximo proyecto

Utiliza el benchmark como punto de partida para formular preguntas, no como un objetivo que todas las páginas deban alcanzar. El presupuesto de rendimiento adecuado depende de la función de la página, su audiencia y las condiciones de red. Una página de pago, un artículo y una página de ubicación pueden tener necesidades de contenido distintas, pero cada una debe permitir realizar su tarea principal sin demoras innecesarias.

Antes de cambiar la arquitectura, establece una línea de base para las páginas importantes. Registra el elemento LCP, los recursos transferidos, el tiempo de bloqueo y los desplazamientos visibles. Cuando sea posible, haz un cambio significativo a la vez y luego repite la prueba. Si el resultado de laboratorio mejora, revisa los datos de campo después del lanzamiento para comprobar si los visitantes también se benefician.

Esta disciplina es especialmente importante durante una migración. Trasladar contenido a un CMS headless no elimina automáticamente los recursos de gran tamaño ni los scripts de terceros. Nuestra guía sobre la [migración de WordPress a una arquitectura headless]({{site}}/wordpress-to-headless-migration/) puede ayudar a definir el trabajo de migración, pero los criterios de aceptación de rendimiento deben formar parte del plan del proyecto desde el principio.

Para un sitio existente, comienza por la plantilla importante más lenta en lugar de abordar una reconstrucción completa. Corregir la imagen LCP de una plantilla muy utilizada puede beneficiar a más visitantes que optimizar una página que se consulta con poca frecuencia.

## Sobre los datos

Las cifras de este informe describen la muestra de 60 sitios y las condiciones de laboratorio utilizadas en 2026. No son un censo de sitios web headless, una comparación de proveedores de alojamiento ni una predicción de la experiencia de usuario en todos los dispositivos. Las medianas ocultan valores atípicos y tres URL no pueden abarcar todas las plantillas de un sitio grande.

Los grupos de frameworks se identificaron para aportar contexto, no se asignaron experimentalmente. Del mismo modo, los rangos de peso de imágenes muestran una asociación dentro de esta muestra; no aíslan el efecto de las imágenes de otras características de las páginas. El umbral combinado utiliza TBT como diagnóstico de laboratorio y no debe presentarse como una evaluación de Core Web Vitals.

{{brand}} se fundó en 2015 y cuenta con 46 personas en sus oficinas de Amsterdam y Berlin. El equipo ha entregado 180 proyectos. Estas cifras de la agencia son independientes de los 60 sitios medidos aquí; el benchmark debe interpretarse según su propia metodología.
