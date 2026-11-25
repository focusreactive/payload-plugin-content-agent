title: Sundari Clinics: 40 sitios de clínicas en un solo modelo de contenido
summary: En 2025, Sundari Clinics unificó los sitios de sus clínicas en torno a un modelo de contenido mediante un proyecto de migración y diseño con {{brand}}. El trabajo combinó un sistema de publicación compartido con espacio para la información local de cada clínica.

## El cliente

Sundari Clinics es una organización sanitaria australiana con una red de sitios web para sus clínicas locales. Cada sitio debe responder a preguntas prácticas: dónde está la clínica, qué servicios ofrece, cómo ponerse en contacto y cómo solicitar una cita. Al mismo tiempo, la red debe ofrecer una experiencia coherente a los pacientes que acuden a distintas sedes.

En 2025, Sundari Clinics trabajó con {{brand}} en un proyecto de migración y diseño para reunir esos sitios en torno a un único modelo de contenido. El trabajo conectó el contenido existente de la organización en [Contentful](https://www.contentful.com) con un nuevo entorno de publicación en [Payload](https://payloadcms.com).

El objetivo no era que todas las páginas de las clínicas fueran idénticas, sino dar una estructura coherente a la información compartida y, al mismo tiempo, permitir que cada clínica mantuviera los datos relevantes para su sede.

## El desafío

Los sitios de las clínicas habían crecido en respuesta a necesidades locales, pero su contenido era difícil de gestionar como una red. Los editores necesitaban mantener la información actualizada sin tener que crear una y otra vez los mismos tipos de páginas.

El proyecto se centró en varios problemas relacionados:

- La información de las clínicas estaba dispersa entre los sitios, en lugar de organizarse en torno a un modelo compartido.
- Los contenidos similares podían tener estructuras diferentes, lo que dificultaba la coordinación de las actualizaciones.
- Los equipos locales necesitaban controlar su información sin modificar el contenido de otras clínicas.
- Las páginas de clínicas y servicios debían ofrecer una forma clara de solicitar citas.
- Era necesario evaluar el contenido existente antes de migrarlo, en lugar de copiarlo sin más a un nuevo sistema.

La migración por sí sola no resolvería estos problemas. El equipo también debía decidir qué contenido se compartiría, cuál seguiría siendo local y cómo se reflejarían esas decisiones en la interfaz.

## El enfoque

{{brand}} combinó la migración de contenido con el trabajo de diseño para abordar conjuntamente el modelo de publicación y la experiencia de los pacientes. El trabajo siguió esta secuencia:

1. **Auditar el contenido.** Revisar el contenido existente sobre clínicas y servicios, identificar estructuras que se repetían y señalar el material que requería atención antes de la migración.
2. **Definir el modelo.** Establecer tipos de contenido y relaciones compartidos para la información de las clínicas, los servicios y las vías para solicitar citas, con espacio para los detalles específicos de cada sede.
3. **Diseñar la experiencia.** Crear patrones de página reutilizables que ayuden a los pacientes a encontrar información relevante y permitan a los editores crear páginas de forma coherente.
4. **Migrar y revisar.** Asignar el contenido existente al nuevo modelo, comprobar los resultados y resolver los problemas junto con las personas responsables de la publicación.
5. **Preparar el uso continuo.** Configurar los permisos y flujos de trabajo editoriales según la distinción entre el contenido de toda la red y el contenido local.

La auditoría de contenido fue importante porque trasladar material inconsistente a un nuevo CMS puede perpetuar los mismos problemas que la migración pretende resolver. El equipo aplicó los principios descritos en su guía para evitar [errores comunes de migración]({{site}}/blog/cms-migration-mistakes/): documentar claramente las decisiones de asignación y reservar tiempo para revisar el contenido en contexto.

## La solución

El modelo compartido separa la información reutilizable de los detalles que pertenecen a cada clínica. Una ficha de clínica puede contener información local, mientras que el contenido sobre servicios puede seguir una estructura coherente en toda la red. Esto ofrece a los editores un lugar más claro donde hacer cambios y reduce la necesidad de volver a crear la estructura de una página para cada sede.

Payload proporciona el entorno de publicación para el nuevo modelo. Las decisiones de acceso están vinculadas a las responsabilidades editoriales: un editor local necesita trabajar con contenido local, mientras que el contenido de toda la red requiere una supervisión más amplia. El artículo del equipo sobre [control de acceso en Payload]({{site}}/blog/payload-access-control-patterns/) explica los tipos de límites que permiten mantener esta estructura a largo plazo.

El diseño aplica la misma distinción a la experiencia de los pacientes. Los patrones de página reutilizables facilitan la localización de la información común, mientras que los detalles específicos de cada clínica permanecen visibles allí donde el paciente los necesita. La solicitud de citas se integra en el recorrido por la información de clínicas y servicios, en lugar de exigir a los pacientes que busquen una vía independiente.

La asignación de la migración conectó el contenido existente de Contentful con las nuevas estructuras. Revisar el material migrado en las páginas diseñadas fue tan importante como comprobar los campos en el CMS: un valor puede transferirse correctamente y aun así requerir atención editorial cuando aparece junto a otra información.

## Los resultados

Sundari Clinics comunicó los siguientes resultados del proyecto:

| Indicador | Antes | Después |
|---|---|---|
| Sitios consolidados | No proporcionado | 40 + |
| Costo del contenido | No proporcionado | 45 % |
| Solicitudes de citas | No proporcionado | 22 % |

Las cifras recogen los resultados proporcionados para el proyecto. No se facilitaron los valores de referencia ni se indicó si los porcentajes representan aumentos o reducciones, por lo que no deben interpretarse como una comparación completa entre el antes y el después.

El modelo entregado ofrece a Sundari Clinics una estructura común para mantener la información de las clínicas, mientras que el diseño proporciona una forma reproducible de presentar esa información en toda la red.

## Los próximos pasos

El modelo compartido es una base para el trabajo editorial continuo, no un sustituto de este. Sundari Clinics puede revisar los datos locales a medida que cambien, mantener de forma centralizada el contenido compartido sobre servicios y evaluar las necesidades de nuevas páginas con respecto a los patrones existentes.

A medida que evolucione la red, será importante comprobar si los editores pueden ubicar la información en la parte adecuada del modelo y si los pacientes pueden encontrarla en las páginas resultantes. Mantener vinculadas estas comprobaciones ayudará a la organización a realizar cambios sin perder la coherencia establecida durante la migración.
