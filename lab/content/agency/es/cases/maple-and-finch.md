title: Maple & Finch: comercio digital a medida con tecnología de código abierto
summary: Maple & Finch lanzó en 2024 una plataforma de comercio electrónico a medida que integra las operaciones comerciales, el contenido y la tienda digital en una arquitectura headless. {{brand}} se encargó del desarrollo y llevó el proyecto desde la planificación hasta el lanzamiento en 6 meses.

## El cliente

Maple & Finch es una empresa canadiense de comercio electrónico. Necesitaba una plataforma que permitiera gestionar su tienda digital sin depender de un único sistema cerrado para sus operaciones de contenido y comercio.

La empresa trabajó con {{brand}} en una solución a medida con tecnología de código abierto. El proyecto combinó [Medusa](https://medusajs.com) para el comercio, [Payload](https://payloadcms.com) para la gestión de contenidos y [Next.js](https://nextjs.org) para la tienda digital que utilizan los clientes. La nueva plataforma se lanzó en 2024.

## El desafío

Un sitio de comercio electrónico debe atender a varios públicos a la vez. Los compradores necesitan un recorrido sencillo desde que descubren un producto hasta que completan el pago, mientras que quienes gestionan el negocio necesitan una forma confiable de mantener el catálogo y publicar contenido.

Maple & Finch quería tener más control sobre esa experiencia y sobre los sistemas que la sustentan. El desarrollo debía abordar varios problemas relacionados entre sí:

- Crear un proceso de pago adaptable al negocio, sin las limitaciones de una tienda digital predeterminada.
- Dar a los editores un espacio para gestionar páginas sin depender de un desarrollador para cada cambio.
- Mantener los datos de productos y operaciones comerciales conectados a la tienda digital, con responsabilidades claras para cada sistema.
- Adoptar una plataforma que permitiera al negocio tomar decisiones informadas sobre las tarifas de la plataforma y el desarrollo futuro.
- Coordinar el desarrollo, las pruebas y el lanzamiento de la nueva experiencia.

Estas necesidades hicieron que la separación de responsabilidades entre sistemas fuera fundamental. Una tienda digital flexible tendría un valor limitado si los editores no pudieran mantenerla o si resultara difícil mantener la información de los productos coherente a lo largo del proceso de compra.

## El enfoque

{{brand}} organizó el desarrollo en torno al recorrido de la información y de los clientes por la plataforma:

1. **Definir responsabilidades.** El equipo asignó los requisitos de la tienda digital, el comercio y el contenido a los sistemas más adecuados para gestionarlos. Los flujos de productos y transacciones correspondían a Medusa; el contenido editorial, a Payload.
2. **Construir los cimientos.** El desarrollo estableció las conexiones necesarias para que la tienda digital de Next.js pudiera obtener datos comerciales y de contenido. Esto proporcionó una base coherente para el trabajo posterior en las páginas y el proceso de pago.
3. **Desarrollar la experiencia.** El equipo creó las páginas que utilizan los clientes y las conectó con los servicios subyacentes, prestando especial atención al recorrido desde la página de producto hasta el pago.
4. **Probar y lanzar.** Antes del lanzamiento, el equipo comprobó que la experiencia funcionara de principio a fin, incluida la publicación de contenido y el uso de los datos necesarios por parte de la tienda digital.

La separación también permitió evaluar los cambios según su contexto. Una página editorial podía evolucionar en el sistema de contenidos sin tratar cada actualización como un cambio comercial. A la inversa, se podían desarrollar las funciones comerciales sin asignar al modelo de contenido la responsabilidad de gestionar transacciones.

Para los equipos que planean migrar un sitio existente de WordPress, {{brand}} también ha documentado [las comprobaciones que realiza en una migración headless]({{site}}/blog/wordpress-to-headless-migration-checklist/). Ese recurso aborda la planificación de la migración; no describe la plataforma anterior de Maple & Finch.

## La solución

La plataforma terminada utiliza Next.js para ofrecer la experiencia de compra, mientras que Medusa y Payload proporcionan fuentes independientes de datos comerciales y editoriales. La tienda digital reúne esa información donde los clientes la necesitan: en las páginas que les permiten explorar, evaluar productos y comprar.

Payload ofrece al cliente un entorno dedicado a la gestión de contenidos. El desarrollo estableció una estructura de contenido que la tienda digital pudiera utilizar, de modo que publicar no dependiera de cambiar su código con cada actualización editorial.

Medusa se encarga de la parte comercial de la arquitectura. Mantener esa responsabilidad separada del contenido editorial da al equipo de desarrollo un lugar más claro para trabajar en las funciones comerciales y su conexión con el proceso de pago.

Se trata de un conjunto de tecnologías de código abierto, no de una promesa de que el mantenimiento desaparezca. La aplicación y sus integraciones siguen necesitando responsables, pruebas y despliegues. Para Maple & Finch, la ventaja es contar con una plataforma cuyos componentes pueden desarrollarse según sus necesidades.

> La tienda digital reúne el comercio y el contenido editorial donde los clientes los necesitan.

## Los resultados

El proyecto se lanzó en 2024, después de 6 meses. Las cifras reportadas se muestran a continuación. La información disponible no especifica valores de referencia ni indica si los porcentajes representan tasas o variaciones, por lo que la tabla no presupone ninguna de las dos cosas.

| Indicador | Antes | Después |
| --- | --- | --- |
| Finalización del proceso de pago | No proporcionado | 16 % |
| Tarifas de la plataforma | No proporcionado | 40 % |
| Tiempo hasta el lanzamiento | No proporcionado | 6 meses |

Las cifras ofrecen un punto de partida para hablar del lanzamiento, pero por sí solas no indican si hubo una mejora o un deterioro. Para evaluar la evolución del proceso de pago o de las tarifas sería necesario definir cada indicador de forma consistente y contar con un valor de referencia comparable.

## Próximos pasos

La arquitectura ofrece a Maple & Finch espacios diferenciados para desarrollar su experiencia de compra, sus flujos comerciales y su contenido editorial. Los trabajos futuros pueden evaluarse teniendo en cuenta esa separación: por ejemplo, un cambio en la tienda digital puede requerir pruebas distintas a las de un cambio en el funcionamiento del proceso de pago o en la estructura del contenido.

El alojamiento es otra decisión continua, no una característica que queda resuelta para siempre en el lanzamiento. Para los equipos que revisen sus opciones después del proyecto, la [guía para elegir una plataforma de alojamiento para Next.js]({{site}}/blog/best-nextjs-hosting-platforms-2026/) de {{brand}} ofrece una perspectiva posterior sobre esa elección.
