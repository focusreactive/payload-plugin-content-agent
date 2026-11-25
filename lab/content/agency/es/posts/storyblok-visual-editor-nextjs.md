title: Editor visual de Storyblok con Next.js: configuración y problemas habituales
excerpt: Conecta el editor visual de Storyblok a una aplicación Next.js, vincula los bloques de contenido con componentes y mantén las vistas previas de borradores separadas de las páginas publicadas.

seoTitle: Editor visual de Storyblok con Next.js: configuración y problemas habituales
seoDescription: Configura el editor visual de Storyblok con Next.js, conecta los bloques de contenido con componentes React y evita problemas habituales de vista previa, rutas y caché.

Un editor visual solo es útil cuando la página que ven los editores coincide con la que verán los visitantes. Con [Storyblok](https://www.storyblok.com) y [Next.js](https://nextjs.org), eso significa coordinar los tipos de contenido, los nombres de los componentes, las URL de vista previa y las reglas de caché, no solo obtener una historia y mostrar sus campos.

Esta guía desarrolla un pequeño ejemplo con App Router, una página y un bloque de funciones anidado. También aborda la separación entre las vistas previas de borradores y las páginas públicas, un punto que suele causar problemas incluso en integraciones que por lo demás funcionan bien. El ejemplo está pensado para un despliegue de vista previa protegido, no como una ruta de producción para visitantes públicos.

## Define qué necesita previsualizar el editor

Empieza por el modelo de contenido y la URL que abrirá el editor. En Storyblok, crea un tipo de contenido llamado `page` con un campo de bloques llamado `body`. Permite un componente anidable llamado `feature` en ese campo y añade a `feature` un campo de texto llamado `headline`. Crea una historia con el slug `home`, elige `page` como tipo de contenido y añade al menos un bloque de funciones.

Estos nombres forman parte de la integración. La clave del componente que devuelve Storyblok debe coincidir con la clave registrada en React, mientras que los nombres de campos como `body` y `headline` deben coincidir con los campos del espacio. Una discrepancia puede hacer que el editor muestre un área en blanco aunque la solicitud a la API se haya completado correctamente.

En este ejemplo, la historia `home` de Storyblok se muestra en la ruta raíz de Next.js. Configura la URL de vista previa de la historia para que apunte a la raíz de tu despliegue de vista previa con HTTPS. Si tu espacio tiene varias rutas, define una convención para relacionar los slugs con las rutas antes de añadir más historias; la ruta de una historia en el CMS no coincide necesariamente con una URL de la aplicación.

En {{brand}}, hemos entregado 180 proyectos desde nuestra fundación en 2015. Puedes [conocer cómo trabaja nuestro equipo]({{site}}/about/) antes de decidir qué parte de la integración desarrollarás por tu cuenta.

## Instala la plantilla inicial y el SDK

{{short}} Starter es nuestra plantilla inicial de código abierto para Next.js y un CMS headless. La versión 3.2 puede proporcionar una estructura inicial al proyecto, pero el modelo de Storyblok y la configuración de la vista previa deben coincidir con el espacio al que te conectas. Sigue las [instrucciones de instalación]({{site}}/docs/getting-started/installation/) de la plantilla y, después, añade el SDK de Storyblok para React en el directorio de la aplicación.

```bash
npx create-headless-starter
npm install @storyblok/react
```

Ejecuta el segundo comando desde el directorio de la aplicación generada, una vez que haya terminado la configuración inicial. El siguiente código es un ejemplo específico de App Router; adapta la ubicación de los archivos y el registro de componentes a la estructura de tu proyecto generado, en lugar de asumir que la plantilla utiliza exactamente estos archivos.

### Configura el acceso de forma deliberada

Usa un token de acceso de vista previa de Storyblok para el despliegue de vista previa y ponlo a disposición del servidor como `STORYBLOK_PREVIEW_TOKEN`. Para el desarrollo local, añade esa variable a `.env.local` y reinicia el servidor de desarrollo después de modificarla. No incluyas el archivo en el repositorio ni expongas el token mediante una variable `NEXT_PUBLIC_`.

Un token de vista previa permite obtener contenido en borrador. Mantenerlo en el servidor evita que se incluya en el código del navegador, pero eso por sí solo no protege las páginas generadas: cualquier persona que pueda acceder a una ruta de vista previa sin protección podría ver los borradores que muestra. Restringe también el acceso al despliegue de vista previa.

La configuración predeterminada y la región del SDK también deben coincidir con tu espacio de Storyblok. Si el espacio utiliza una región de datos distinta de la predeterminada por el SDK, configura la región correspondiente durante la inicialización del SDK antes de probar la solicitud.

## Vincula los bloques de Storyblok con componentes React

Para crear una ruta de vista previa mínima, el siguiente archivo `app/page.js` inicializa el SDK, registra los dos nombres de componentes y obtiene la historia `home` como borrador. Si tu proyecto usa un directorio `src` para App Router, coloca la ruta en `src/app`.

```js
import {
  apiPlugin,
  storyblokEditable,
  storyblokInit,
  StoryblokComponent,
  StoryblokStory,
} from "@storyblok/react/rsc";

function Page({ blok }) {
  return (
    <main {...storyblokEditable(blok)}>
      {blok.body?.map((child) => (
        <StoryblokComponent blok={child} key={child._uid} />
      ))}
    </main>
  );
}

function Feature({ blok }) {
  return (
    <section {...storyblokEditable(blok)}>
      <h2>{blok.headline}</h2>
    </section>
  );
}

const getStoryblokApi = storyblokInit({
  accessToken: process.env.STORYBLOK_PREVIEW_TOKEN,
  use: [apiPlugin],
  components: { page: Page, feature: Feature },
});

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data } = await getStoryblokApi().get("cdn/stories/home", {
    version: "draft",
  });

  return <StoryblokStory story={data.story} />;
}
```

### Cómo funciona cada vinculación

`StoryblokStory` muestra la historia mediante el componente raíz registrado y facilita la integración con el editor visual. El componente `page` recorre su campo `body`, y `StoryblokComponent` selecciona un componente registrado para cada bloque anidado. `_uid` es un identificador estable que acompaña a cada bloque de Storyblok y puede usarse como clave de React.

`storyblokEditable` añade los atributos que Storyblok utiliza para asociar los elementos mostrados con los bloques editables. Aplícalo al elemento que representa cada bloque, incluidos los anidados, para que el editor pueda seleccionar la parte correcta de la vista previa.

Este ejemplo utiliza componentes React convencionales para mostrar cómo se hace la vinculación. Al integrarlo en un proyecto basado en una plantilla inicial, consulta las [convenciones de bloques]({{site}}/docs/reference/blocks/) existentes antes de añadir otro registro. Dos registros que compiten entre sí dificultan identificar qué componente muestra un bloque determinado del CMS.

La configuración de ruta dinámica evita que esta página se trate como un resultado estático generado durante la compilación. No sustituye la revisión de las cachés del SDK, la plataforma y el CDN, ni la protección del despliegue de vista previa.

## Conecta y prueba el editor visual

Configura la URL de vista previa de la historia para que apunte al despliegue protegido que ejecuta el ejemplo y, después, abre la historia en el editor visual de Storyblok. Usa un despliegue cuya configuración de HTTPS y acceso permita al editor cargar la página dentro de su marco de vista previa.

1. Abre la historia `home` y confirma que la vista previa carga la ruta raíz de la aplicación.
2. Selecciona el bloque de funciones en la página y comprueba que Storyblok seleccione el bloque de contenido correspondiente.
3. Cambia el titular en el editor y comprueba si la vista previa refleja la edición.
4. Añade, reordena y elimina bloques de funciones, y confirma que el orden mostrado coincida con el campo `body`.
5. Vuelve a cargar el editor y prueba de nuevo con un cambio sin publicar, no solo con contenido ya publicado.

Si la página se muestra pero la selección no funciona, comprueba si el elemento correspondiente recibe los atributos editables. Si el marco aparece en blanco, revisa la URL de vista previa, la consola del navegador, los registros del despliegue y los encabezados de respuesta antes de cambiar el código de los componentes. Una política de seguridad de contenido o una restricción de marcos puede impedir que una ruta que funciona correctamente se cargue dentro de Storyblok.

> **Consejo práctico:** Mantén una historia pequeña con una página y un solo bloque de funciones para comprobar la integración. Así será más fácil aislar un fallo de rutas o de registro de componentes que con una página de marketing completa con muchos bloques anidados.

Las actualizaciones en tiempo real dependen de que el puente del editor y el árbol de componentes mostrado funcionen de forma conjunta. Prueba ediciones reales en el editor visual, en lugar de dar por hecho que toda la experiencia de edición funciona porque la respuesta inicial de la API fue correcta.

## Separa las vistas previas de borradores de la entrega de contenido publicado

El ejemplo solicita deliberadamente `version: "draft"`. Esto es apropiado para una vista previa restringida, pero una ruta pública de producción debe obtener la versión publicada. Usa una configuración de despliegue independiente o un modo de vista previa implementado cuidadosamente para impedir que un visitante cambie una página pública a contenido en borrador mediante un parámetro no confiable.

### Define los límites de la caché

Un sitio público rápido puede almacenar en caché las respuestas publicadas, mientras que los editores suelen necesitar que los cambios aparezcan rápidamente en la vista previa. Son requisitos distintos y deben probarse por separado. La generación de rutas de Next.js, el SDK de Storyblok y cualquier capa de alojamiento o CDN pueden afectar la actualización del contenido.

| Aspecto | Comportamiento en vista previa | Comportamiento público |
|---|---|---|
| Versión del contenido | Solicitar borradores | Solicitar contenido publicado |
| Acceso | Restringir el despliegue o la ruta | Permitir el acceso a los visitantes previstos |
| Actualización | Evitar borradores desactualizados durante la edición | Usar una estrategia de caché explícita |
| Credenciales | Mantener el acceso de vista previa en el servidor | Usar credenciales de entrega apropiadas |
| Comprobación de fallos | Verificar una edición sin publicar | Verificar un cambio recién publicado |

Para las páginas públicas, decide cómo la publicación invalida o actualiza el contenido almacenado en caché. Un flujo de revalidación mediante webhooks puede ser útil, pero protege su endpoint y verifica el alcance de la invalidación. Prueba una publicación, una actualización y una retirada de publicación; una política de caché que solo contemple el primer caso puede dejar contenido obsoleto visible.

Ten en cuenta también el contenido compartido. Actualizar una función reutilizada en varias páginas puede requerir algo más que invalidar la URL de la historia que se está editando. La estrategia exacta depende de cómo tu aplicación obtenga y combine ese contenido.

## Resuelve los problemas que detectan los editores

Cuando falla una vista previa, empieza por la diferencia observable más pequeña entre el CMS y la aplicación. Estas comprobaciones cubren problemas que suelen parecer similares en el editor, pero tienen causas diferentes:

- **Falta un bloque:** Compara el nombre del componente en Storyblok con la clave de registro, incluidas las mayúsculas y la ortografía.
- **Un campo está vacío:** Comprueba el nombre técnico del campo y la estructura que devuelve la Content Delivery API, no solo su etiqueta en el editor.
- **Aparece la página equivocada:** Comprueba por separado el slug de la historia, la URL de vista previa y la ruta de la aplicación.
- **Las ediciones no aparecen:** Comprueba el comportamiento del puente y las capas de caché, y después prueba un cambio sin publicar.
- **El contenido en borrador aparece públicamente:** Deja de exponer la ruta, revisa los controles de acceso y los tokens, y separa la obtención de borradores de la entrega de contenido publicado.

Mantén el modelo de contenido y el registro de componentes bajo control de cambios. Cambiar el nombre de un componente en Storyblok sin desplegar el cambio correspondiente en la aplicación puede hacer que las historias existentes dejen de funcionar. Para migraciones más grandes, introduce la nueva vinculación, actualiza y verifica el contenido y, solo entonces, elimina la anterior.

Por último, elige el CMS en función del flujo de trabajo editorial que realmente necesitas. Storyblok es un CMS headless comercial con editor visual; no es un CMS de código abierto. Si necesitas tener el control del código del CMS, compara las opciones en nuestra [guía de CMS de código abierto]({{site}}/blog/best-open-source-cms-2025/) antes de comprometerte con una integración.
