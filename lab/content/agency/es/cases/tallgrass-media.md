title: Tallgrass Media: de WordPress a una redacción headless
summary: Tallgrass Media trasladó su redacción a una plataforma de publicación headless diseñada en torno a las necesidades de su equipo editorial y sus lectores. La migración incorporó su archivo al nuevo sistema y preparó la publicación para ofrecer una experiencia más rápida.

## El cliente

Tallgrass Media es una empresa de medios de Estados Unidos con una redacción digital y un archivo de artículos publicados. Su equipo editorial necesitaba mantener el ritmo de la cobertura diaria y, al mismo tiempo, facilitar a los lectores el acceso a los artículos anteriores.

La publicación había crecido sobre [WordPress](https://wordpress.org), donde la gestión de contenidos y la presentación de las páginas estaban estrechamente vinculadas. Tallgrass encargó a {{brand}} la migración de la redacción y el desarrollo de una plataforma headless que separara el trabajo editorial de la capa de presentación.

El proyecto se lanzó en 2023. Abarcó tanto el archivo como el flujo de trabajo para los nuevos artículos, por lo que el cambio debía responder a las necesidades del equipo editorial y de los lectores que llegaban a través de enlaces existentes.

## El desafío

Migrar una redacción no consiste simplemente en trasladar textos a otra base de datos. Tallgrass necesitaba llevar su historial editorial a un nuevo entorno de publicación sin tratar cada artículo como una página aislada.

El equipo se enfrentó a varios problemas relacionados entre sí:

- El archivo existente contenía artículos, imágenes y metadatos editoriales que debían conservar su relación tras la migración.
- Las URL existentes tenían valor para los lectores, los motores de búsqueda y los enlaces de otras publicaciones.
- Los editores necesitaban una forma práctica de crear y actualizar artículos sin depender de desarrolladores para los cambios habituales.
- Las páginas de artículos debían cargar más rápido y, a la vez, seguir incluyendo publicidad.
- El nuevo frontend necesitaba margen para evolucionar sin obligar a realizar otra migración de contenidos.

El desafío era atender todas esas necesidades de forma conjunta. Una página rápida sería de poca utilidad si sus enlaces no funcionaran, mientras que un archivo conservado sería más difícil de mantener si la nueva experiencia de edición ralentizara el trabajo de la redacción.

## El enfoque

{{brand}} organizó el trabajo en torno al contenido y a las personas responsables de él, en lugar de centrarse únicamente en las plantillas de página.

1. **Auditar la redacción existente.** El equipo revisó la estructura del contenido en WordPress, incluidos los campos de los artículos, los archivos multimedia y los patrones de URL. Esto permitió determinar qué debía migrarse y qué información tendría que admitir el nuevo sistema.
2. **Modelar el contenido.** Los artículos y la información relacionada se organizaron en un modelo de contenido headless. El modelo proporcionó a los editores campos para el material que gestionan y al frontend una fuente de datos coherente.
3. **Migrar y verificar.** El archivo se transfirió al nuevo sistema y se contrastó con el contenido de origen. La planificación de las redirecciones formó parte de la migración desde el principio; la [guía de redirecciones]({{site}}/docs/guides/redirects/) de {{brand}} explica los aspectos que deben considerarse para preservar las rutas.
4. **Desarrollar y lanzar.** El equipo desarrolló el nuevo frontend, lo conectó al CMS y comprobó los flujos de trabajo editoriales y la experiencia de los lectores antes del lanzamiento.

Durante todo el proyecto, el objetivo fue preservar la utilidad del contenido existente y, al mismo tiempo, proporcionar a la redacción una base que pudiera mantener.

## La solución

La nueva plataforma utiliza [Payload](https://payloadcms.com) como CMS headless y [Next.js](https://nextjs.org) para el frontend. Payload ofrece un espacio para gestionar contenido editorial estructurado; Next.js utiliza ese contenido para generar el sitio público. Esta separación permite al equipo cambiar la presentación de un artículo sin tener que reescribirlo.

El modelo de artículo mantiene unidos los elementos de cada pieza, incluidos el cuerpo del texto, los archivos multimedia asociados y los metadatos. Esta estructura es importante durante la migración, pero también facilita el trabajo editorial habitual después del lanzamiento: los editores pueden actualizar el contenido en el CMS mientras el frontend se encarga de su presentación en el sitio.

La migración también tuvo en cuenta las rutas que los lectores ya conocían. Las redirecciones conectan las rutas anteriores con sus destinos en el nuevo sitio, lo que reduce la posibilidad de que un lector que siga un enlace existente llegue a una página inexistente.

El rendimiento y la publicidad se abordaron de forma conjunta en el frontend. El equipo desarrolló las páginas de artículos para ofrecer el contenido de manera eficiente y, al mismo tiempo, mantener espacio para los anuncios dentro de la experiencia de lectura. Así se evitó tratar la publicidad como un elemento independiente que se añade solo después de completar la página.

> “Necesitábamos migrar el archivo sin pedirle a la redacción que dejara de publicar. La nueva plataforma nos ofrece una forma más clara de gestionar los artículos y seguir desarrollándolos”.
>
> — Maya Reed, directora editorial, Tallgrass Media

## Los resultados

El lanzamiento incorporó el archivo a la nueva plataforma y produjo cambios medibles en la experiencia de lectura. Tallgrass comunicó los siguientes resultados; no se especificaron las cifras iniciales de tiempo de carga ni de visibilidad de los anuncios.

| Indicador | Antes | Después |
|---|---|---|
| Páginas migradas | En WordPress | 12000 páginas |
| Mejora del tiempo de carga | No especificado | 64 % |
| Visibilidad de los anuncios | No especificado | 18 % |

El resultado del tiempo de carga describe la mejora comunicada, mientras que la cifra de visibilidad de los anuncios se presenta como un valor y no como un incremento. Junto con el archivo migrado, estos datos muestran lo que logró el proyecto sin recurrir a cifras iniciales no especificadas.

## Próximos pasos

Tallgrass cuenta ahora con una plataforma de publicación en la que el contenido editorial y el desarrollo del frontend pueden avanzar a ritmos distintos. La redacción puede seguir manteniendo su archivo en el CMS, mientras que el equipo de desarrollo puede perfeccionar la experiencia de lectura sin cambiar el lugar donde se crean los artículos.

Esta distinción también facilita la evaluación del trabajo futuro: un cambio en la presentación de los artículos puede considerarse por separado de un cambio en el modelo de contenido. Para conocer otro ejemplo del trabajo de {{brand}} en un flujo de publicación, consulta [el proyecto del sitio de marketing de Quillstack]({{site}}/case-studies/quillstack/).
