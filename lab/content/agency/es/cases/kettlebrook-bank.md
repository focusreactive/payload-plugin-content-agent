title: Kettlebrook Bank: 1,400 páginas migradas sin pérdida de tráfico
summary: Kettlebrook Bank lanzó su sitio web migrado en 2024, trasladando 1400 páginas a Contentful y Next.js. El proyecto combinó una auditoría con un plan de migración diseñado para proteger la visibilidad en buscadores y facilitar la publicación de contenidos en el futuro.

## El cliente

Kettlebrook Bank es una empresa británica de tecnología financiera cuyo sitio web atiende a personas que buscan información sobre sus servicios. Su contenido debía ser fácil de encontrar y navegar, además de sencillo de gestionar para el equipo encargado de mantenerlo actualizado.

Para el lanzamiento de 2024, el banco trabajó con {{brand}} en una auditoría y una migración a [Contentful](https://www.contentful.com) y [Next.js](https://nextjs.org). El proyecto abarcó tanto el contenido del sitio como la experiencia de sus visitantes.

{{brand}} trabaja en proyectos headless desde su fundación en 2015. Sus equipos de Ámsterdam y de la [oficina de Berlín]({{site}}/blog/berlin-office-opening/) reúnen la experiencia en contenido y tecnología necesaria para migraciones de este tipo.

## El desafío

Migrar un sitio web de gran tamaño no consiste simplemente en copiar texto a un sistema nuevo. Una página puede depender de su URL, de los enlaces desde otras páginas, de sus metadatos y de contenido reutilizable. Cada uno de estos elementos requiere atención para que los visitantes y los buscadores encuentren la información correcta después del lanzamiento.

La auditoría permitió centrar la migración en los problemas con mayor probabilidad de afectar al flujo de publicación del banco y a su presencia en buscadores:

- Era necesario identificar todo el contenido existente antes de trasladarlo o revisarlo.
- Las estructuras de página y el contenido reutilizable necesitaban un modelo coherente en el nuevo CMS.
- Las URL y los enlaces internos debían seguir funcionando después de la migración.
- Los metadatos para buscadores debían trasladarse junto con el contenido que describían.
- El nuevo sitio debía mostrar las páginas de forma eficiente sin complicar innecesariamente la edición.

La magnitud del contenido hacía importante abordar la revisión editorial y la implementación técnica como tareas interdependientes. Un modelo de contenido preciso serviría de poco si los enlaces se rompieran durante el lanzamiento; del mismo modo, un sitio rápido no resolvería el problema del banco si los editores no pudieran mantener sus páginas.

## El enfoque

{{brand}} estructuró el trabajo en torno a una auditoría, un plan de migración y comprobaciones del sitio resultante. Este enfoque permitió al equipo hacer seguimiento de cada contenido desde su ubicación original hasta su lugar en el nuevo sistema de publicación.

1. **Auditar el contenido y la estructura.** Revisar el inventario de páginas junto con las URL, los metadatos y las relaciones entre páginas. Identificar la información necesaria para reproducir cada página en el nuevo sistema.
2. **Definir el modelo de contenido.** Organizar las páginas y los elementos reutilizables en Contentful para que los editores puedan mantener el contenido sin tener que tratar cada página como un desarrollo independiente.
3. **Migrar y validar.** Trasladar el contenido al nuevo modelo y, después, comprobar las páginas generadas, los enlaces y los metadatos según el plan de migración.
4. **Preparar el lanzamiento.** Revisar el tratamiento de las URL existentes y el rendimiento del sitio en Next.js antes de poner la nueva experiencia a disposición del público.

Esta secuencia mantuvo la migración alineada con las necesidades de publicación del banco, en lugar de dejar que la estructura del CMS determinara el sitio web. El mismo principio se aplica a otros proyectos headless, incluidos los [proyectos de comercio electrónico]({{site}}/headless-ecommerce/), donde el contenido y la presentación también deben funcionar en conjunto.

## La solución

Contentful ofrece al equipo del banco un espacio para gestionar contenido estructurado. Next.js utiliza ese contenido para generar el sitio web. Separar el contenido de la presentación permite a los editores tener una visión más clara de lo que gestionan y, al mismo tiempo, desarrollar la interfaz del sitio en torno a las necesidades de los visitantes.

El modelo de contenido fue fundamental para la migración. El contenido de las páginas, los metadatos y los materiales reutilizables necesitaban un lugar claramente definido en el CMS para poder revisarlos y mantenerlos después del lanzamiento. El trabajo de migración también tuvo en cuenta las conexiones entre páginas: es más fácil preservar una página cuando se entienden en conjunto su destino, sus enlaces y su propósito.

La visibilidad en buscadores dependía de algo más que trasladar el texto principal. El proyecto trató las URL y los metadatos como parte de cada registro de contenido y recurrió a la validación para comprobar que el nuevo sitio mostrara la información prevista. Así, la auditoría fue relevante durante toda la implementación, no solo al principio.

El rendimiento también formó parte de la implementación. Next.js proporcionó al equipo un framework para desarrollar la experiencia de cara al público, mientras que las comprobaciones de las páginas ayudaron a evaluar cómo se mostraba el contenido migrado.

## Los resultados

El lanzamiento trasladó el contenido del banco a la nueva plataforma sin pérdida de tráfico. Los resultados del proyecto se comunicaron de la siguiente manera:

| Métrica | Antes | Después |
|---|---|---|
| Páginas migradas | No proporcionado | 1400 páginas |
| Tráfico orgánico | No proporcionado | 12 % |
| Largest Contentful Paint | No proporcionado | 900 ms |

La cifra de tráfico orgánico se presenta tal como se proporcionó; no se especifican el período de comparación ni el cálculo utilizado. El resultado de Largest Contentful Paint corresponde a la medición del lanzamiento, sin una cifra anterior a la migración que permita compararlo.

> Kettlebrook Bank: 1,400 páginas migradas sin pérdida de tráfico

Kettlebrook Bank, cliente

## Próximos pasos

La migración proporciona al banco una base estructurada para mantener su sitio web después del lanzamiento. Su equipo puede seguir revisando contenidos, actualizando información y supervisando las páginas que consultan los visitantes.

De cara a futuros cambios, la auditoría y el modelo de contenido ofrecen una referencia útil: los editores pueden evaluar dónde incorporar nuevos materiales, cómo se relacionan con las páginas existentes y qué metadatos necesitan. Seguir prestando atención a las URL, los enlaces internos y el rendimiento ayudará al banco a mantener la experiencia lograda con la migración.
