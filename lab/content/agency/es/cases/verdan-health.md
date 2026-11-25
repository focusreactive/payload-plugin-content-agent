title: Verdan Health: una plataforma de contenidos para seis idiomas
summary: Verdan Health lanzó en 2024 una plataforma de contenidos multilingüe que reúne sus contenidos de salud en Storyblok y Nuxt. La migración permitió a sus equipos gestionar las páginas y coordinar la localización de forma conjunta.

## El cliente

Verdan Health es una empresa del sector salud con sede en Alemania. Su sitio web se dirige a públicos de seis idiomas, con contenidos que deben ser claros y coherentes mientras los equipos locales los adaptan a sus mercados.

En 2024, Verdan Health trabajó con {{brand}} en un proyecto de migración y localización. El objetivo era trasladar las páginas existentes a una plataforma de contenidos compartida, sin tratar cada idioma como un sitio web independiente. [El equipo de la agencia]({{site}}/about/) aportó la experiencia de sus oficinas de Ámsterdam y Berlín.

## El desafío

El contenido existente había crecido en distintos mercados, lo que dificultaba que los editores identificaran las relaciones entre las páginas. La migración del sitio requería preservar el material útil y, al mismo tiempo, ofrecer a los equipos una forma más fiable de mantenerlo.

El proyecto planteaba varios problemas relacionados:

- Era necesario inventariar las páginas antes de la migración, incluidas sus variantes lingüísticas y sus relaciones con otros contenidos.
- Los equipos locales necesitaban margen para adaptar los textos sin tener que reconstruir las estructuras de página para cada mercado.
- El contenido compartido necesitaba responsables claramente definidos para evitar que un cambio en un idioma generara inconsistencias inadvertidas en otros.
- Los editores necesitaban un proceso de publicación que permitiera verificar la revisión antes de publicar información de salud.

Una simple transferencia página por página habría trasladado el contenido sin resolver esos problemas editoriales. Por eso, el trabajo debía abarcar tanto la migración como la forma en que Verdan Health gestionaría después el contenido localizado.

## El enfoque

{{brand}} organizó el trabajo en torno al contenido, en lugar de comenzar con un rediseño visual.

1. **Auditoría y mapeo.** Los equipos revisaron las páginas existentes, identificaron las variantes lingüísticas y mapearon el contenido en una estructura compartida. Así se determinó qué había que migrar y dónde lo mantendrían los editores.
2. **Modelado y migración.** Definieron componentes y campos reutilizables para las páginas y, después, trasladaron el contenido a la nueva plataforma. Las comprobaciones de la migración compararon el material original con las nuevas entradas para corregir contenidos faltantes o mal ubicados.
3. **Localización y revisión.** Los equipos locales revisaron las variantes lingüísticas en contexto, comprobando los textos, los enlaces y la estructura de las páginas antes de su publicación.
4. **Lanzamiento y entrega.** Los equipos probaron el flujo de publicación y prepararon a los editores para mantener las páginas después del lanzamiento.

Esta secuencia proporcionó un marco común para la migración y la localización. En lugar de pedir a los traductores que trabajaran a partir de copias de páginas desconectadas entre sí, Verdan Health pudo organizar el trabajo lingüístico en torno a contenidos que ya se habían mapeado y revisado.

## La solución

La plataforma utiliza [Storyblok](https://www.storyblok.com) para gestionar el contenido y [Nuxt](https://nuxt.com) para mostrar el sitio web. Storyblok proporciona el entorno editorial para el contenido estructurado, mientras que la aplicación Nuxt presenta ese contenido a los visitantes.

Los componentes reutilizables ofrecen a los editores una forma coherente de crear páginas. Los campos para títulos, texto y enlaces mantienen el contenido separado de su presentación, mientras que las estructuras de página proporcionan un punto de partida común para las variantes localizadas. Esto facilita la revisión integral de cada página sin obligar a todos los mercados a publicar textos idénticos.

El trabajo de migración incluyó la comprobación de la ubicación del contenido y de las relaciones entre páginas. Después, los editores pudieron revisar cada versión lingüística frente al material original correspondiente y resolver los problemas antes de publicar. El proceso también dio a los equipos locales un espacio más claro para señalar los textos que necesitaban adaptación en lugar de una traducción directa.

El resultado fue una plataforma diseñada para el trabajo editorial continuo, no solo para el lanzamiento. Un modelo compartido favorece la coherencia, mientras que la localización sigue siendo una tarea de revisión específica para los responsables de cada mercado.

> Verdan Health lanzó su plataforma de contenidos multilingüe en 2024.

Verdan Health, cliente

## Los resultados

El proyecto migró 820 páginas. Verdan Health también comunicó cifras sobre el tiempo de traducción y el tráfico orgánico. Los resultados disponibles no especifican una referencia inicial ni indican la dirección del cambio para esos porcentajes, por lo que se presentan aquí sin interpretarlos como aumentos o reducciones.

| Indicador | Antes | Después |
|---|---|---|
| Tiempo de traducción | No proporcionado | 60 % |
| Páginas migradas | No proporcionado | 820 páginas |
| Tráfico orgánico | No proporcionado | 31 % |

Más allá de las cifras comunicadas, la plataforma entregada ofrece a Verdan Health una estructura compartida para mantener el contenido en todos sus idiomas. Los editores pueden trabajar con elementos de página reutilizables y los revisores locales tienen una función definida en el proceso de publicación.

## Próximos pasos

Verdan Health puede seguir perfeccionando su modelo de contenidos a medida que los equipos identifiquen los componentes y las etapas de revisión que más utilizan. La prioridad inmediata es mantener la estructura compartida: definir claramente quién es responsable de cada página, revisar los textos localizados en contexto y comprobar los enlaces cuando cambie el contenido.

Para los equipos que planean un proyecto independiente con Next.js, {{brand}} también ofrece {{short}} Starter, un kit de inicio de código abierto para Next.js y un CMS headless. Su documentación explica [cómo configurarlo]({{site}}/docs/getting-started/installation/). Este kit es independiente de la implementación de Nuxt de Verdan Health.
