title: Localización en un CMS headless: campos, configuraciones regionales y valores alternativos
excerpt: Los campos localizados, las reglas regionales y los valores alternativos determinan la experiencia multilingüe. Descubre cómo modelarlos, publicarlos y probarlos en un CMS headless.
seoTitle: Localización en un CMS headless: campos, configuraciones regionales y valores alternativos
seoDescription: Aprende a modelar campos localizados, elegir valores alternativos y crear un flujo de publicación que mantenga el contenido multilingüe preciso y útil.

Un CMS headless puede distribuir el mismo contenido a varios mercados, pero almacenar una traducción es solo una parte del trabajo. También hay que decidir qué campos varían, qué ocurre cuando falta una traducción y si una página está lista para publicarse en cada configuración regional. Estas decisiones afectan a los equipos editoriales, las API, los motores de búsqueda y las personas que leen la página final.

Por Ines Okafor, estratega de contenidos en {{brand}}

## Comienza por los campos, no por los idiomas

Antes de añadir configuraciones regionales, separa el contenido que cambia según el mercado del que debe mantenerse uniforme. El nombre de un producto podría ser el mismo en todas partes, mientras que su descripción, la forma de mostrar el precio y los textos legales pueden necesitar una adaptación local. Incluso un campo que parece universal, como una imagen, puede contener texto incrustado o mostrar un producto que no está disponible en un mercado concreto.

Las funciones de localización varían según la plataforma. [Payload](https://payloadcms.com) permite a los desarrolladores marcar campos como localizados en la configuración de una colección. [Storyblok](https://www.storyblok.com) admite la traducción a nivel de campo, además de otros enfoques para el contenido multilingüe. [Contentful](https://www.contentful.com) admite la localización a nivel de campo y ofrece ajustes regionales para gestionar los valores traducidos. El modelo adecuado depende del contenido y del flujo de trabajo, no solo del CMS.

Un inventario de campos permite ver las implicaciones de cada decisión:

| Campo | Tratamiento habitual | Decisión pendiente |
|---|---|---|
| ID interno del producto | Compartido | Mantener un identificador estable en todas las configuraciones regionales. |
| Título de la página | Localizado | Exigir un valor antes de publicar una configuración regional. |
| Imagen principal y texto alternativo | Posiblemente localizados | Decidir si varían la imagen, el texto alternativo o ambos. |
| Precio | Específico del mercado | Almacenar la moneda y el importe de forma explícita; no traducir una cadena formateada. |
| Slug de la URL | Localizado | Definir las reglas de unicidad y redirección dentro de cada configuración regional. |
| Aviso legal | Localizado | Asignar una revisión local y decidir si se permite usar un valor alternativo. |

### Compartido no significa válido en todas partes

Un campo compartido reduce la duplicación, pero también crea una dependencia: cualquier cambio afecta a todas las configuraciones regionales que lo usan. Si una imagen es compartida, quien la reemplace debe saber que el cambio puede verse en todos los mercados. Si la disponibilidad varía según el país, un registro de producto compartido puede necesitar datos de mercado independientes, en lugar de una frase traducida sobre la disponibilidad.

Por el contrario, localizarlo todo genera trabajo innecesario. Los equipos editoriales no deberían tener que copiar una unidad de mantenimiento de stock en tres variantes de idioma. Usa campos compartidos para los identificadores y las relaciones estables, y localiza los valores que tienen significado lingüístico o comercial.

Para los equipos que estudian un esquema personalizado, nuestro trabajo en [implementaciones de Payload]({{site}}/payload-cms-development/) comienza con esas decisiones sobre el contenido, antes de desarrollar la capa de distribución.

## Define las configuraciones regionales y sus responsabilidades

Una configuración regional identifica el idioma y, cuando es necesario, el contexto regional de un contenido. `de` puede representar el alemán en general; `de-CH` distingue el alemán de Suiza. Estas etiquetas no traducen los textos ni determinan por sí solas los requisitos legales. El equipo debe decidir qué significa cada configuración regional en el CMS y en el sitio web.

### El idioma no es lo mismo que el mercado

Dos mercados pueden compartir un idioma y, aun así, necesitar distintas monedas, información de entrega o datos de contacto. Del mismo modo, un mercado puede ofrecer contenido en más de un idioma. Trata el idioma, el mercado y la moneda como conceptos independientes cuando el negocio lo requiera, aunque un sitio sencillo asocie inicialmente una configuración regional con un solo mercado.

Elige la configuración regional predeterminada de forma deliberada. A menudo funciona como primera versión editorial o como base para contenido nuevo, pero no debería convertirse automáticamente en la solución para todos los valores ausentes. Un idioma predeterminado puede ser útil para el nombre interno de un producto e inapropiado para una cláusula contractual.

Documenta la política en términos que el equipo editorial pueda utilizar:

- **Códigos regionales:** Enumera los códigos admitidos y el público al que se dirige cada uno.
- **Responsables:** Indica qué rol se encarga de la traducción, la revisión y la aprobación en cada configuración regional.
- **Campos obligatorios:** Identifica los campos que deben estar completos antes de publicar una configuración regional.
- **Reglas de mercado:** Especifica qué precios, ofertas y datos legales no pueden heredarse.
- **Retirada:** Decide cómo redirigir o archivar las URL cuando se elimine una configuración regional.

Esta política debe formar parte del modelo de contenido. De lo contrario, los desarrolladores podrían implementar una interpretación mientras el equipo editorial sigue otra.

## Define explícitamente cuándo usar valores alternativos

Un valor alternativo sustituye un valor ausente por otro de una configuración regional distinta. Por ejemplo, si falta una descripción en alemán de Suiza, se podría recurrir al alemán general y después al inglés. Esto puede evitar que una tarjeta aparezca vacía en una página de listado, pero también puede generar una página que mezcle idiomas sin previo aviso.

Los valores alternativos son más útiles cuando el costo de dejar un campo vacío es mayor que el de mostrar un valor de otra configuración regional. Una etiqueta técnica compartida puede ser una candidata razonable. Una restricción de envío, un precio o un aviso obligatorio por ley suelen necesitar un valor explícito para el mercado de destino o una indicación clara de que no están disponibles.

### Distingue lo que falta de lo que se deja vacío intencionalmente

Una traducción puede faltar porque nadie la ha redactado, porque está pendiente de revisión o porque alguien del equipo editorial la eliminó intencionalmente. Tratar los tres casos como si fueran el mismo estado hace que el uso de valores alternativos sea impredecible.

El siguiente ejemplo es una representación genérica de contenido, no una respuesta de API específica de un CMS. El estado de la traducción se mantiene separado del texto:

```json
{
  "field": "intro",
  "translations": {
    "en": {
      "status": "approved",
      "value": "Plan your journey with confidence."
    },
    "de": {
      "status": "approved",
      "value": "Planen Sie Ihre Reise mit Sicherheit."
    },
    "de-CH": {
      "status": "missing",
      "value": null
    }
  }
}
```

Si la política permite que `de-CH` recurra a `de`, la capa de distribución puede mostrar el valor en alemán. También debe conservar la configuración regional de origen, para que la aplicación pueda informar del uso de un valor alternativo y aplicar los metadatos de idioma correctos cuando corresponda.

Un valor dejado en blanco deliberadamente necesita una representación diferente, como un estado `suppressed` explícito. En ese caso, el sistema no debería sustituir automáticamente el espacio en blanco por otro idioma. Acuerden estos estados antes de que el equipo editorial empiece a cargar contenido.

> **Consejo práctico:** Haz visible el uso de valores alternativos en la vista previa. Muestra la configuración regional solicitada, la de origen y el campo que falta para que el equipo editorial pueda distinguir una traducción aprobada del contenido tomado de otra configuración.

## Implementa y revisa la cadena de valores alternativos

Mantén la lógica de valores alternativos en un solo lugar, en vez de dispersarla entre componentes. El siguiente ejemplo resuelve el texto aprobado mediante una lista ordenada proporcionada por la aplicación. Omite los valores ausentes, no aprobados o compuestos solo por espacios en blanco, y devuelve la configuración regional de la que procede el resultado.

```ts
type Translation = {
  status: "approved" | "missing" | "draft";
  value: string | null;
};

type Resolution = {
  value: string;
  sourceLocale: string;
} | null;

function resolveText(
  translations: Record<string, Translation | undefined>,
  localeChain: string[]
): Resolution {
  for (const locale of localeChain) {
    const entry = translations[locale];

    if (
      entry?.status === "approved" &&
      entry.value !== null &&
      entry.value.trim() !== ""
    ) {
      return { value: entry.value, sourceLocale: locale };
    }
  }

  return null;
}

const result = resolveText(
  {
    de: { status: "approved", value: "Guten Tag" },
    "de-CH": { status: "missing", value: null }
  },
  ["de-CH", "de", "en"]
);
```

En este caso, `result` contiene `Guten Tag` y `de` como configuración regional de origen. Un resultado `null` significa que el componente que hace la llamada debe elegir cómo representar adecuadamente la ausencia de contenido; no debe inventar una traducción. Una implementación en producción también necesita una regla explícita para el contenido suprimido intencionalmente, que este ejemplo sencillo no contempla.

Un CMS puede ofrecer su propio mecanismo de valores alternativos. Comprueba si la API devuelve la configuración regional de origen y el estado de traducción que necesita la aplicación; si no es así, el equipo quizá necesite otra forma de obtener esa información. Evita aplicar en el frontend una segunda cadena de valores alternativos que entre en conflicto con la primera.

La [guía de localización de la documentación de {{short}} Starter]({{site}}/docs/guides/localization/) es un punto de partida útil para los equipos que trabajan con {{short}} Starter, el kit de inicio de código abierto para Next.js y un CMS headless. La misma cuestión de diseño se aplica a cualquier stack: define la cadena una sola vez, documenta las excepciones y asegúrate de que el resultado se pueda supervisar.

## Crea un flujo de publicación para cada configuración regional

Un campo traducido no es necesariamente un campo aprobado. El equipo editorial necesita saber si una configuración regional está incompleta, en revisión, lista o publicada. Estos estados pueden existir a nivel de página, de campo o de ambos; elige el nivel que refleje cómo trabaja realmente el equipo.

Un proceso práctico de publicación sería:

1. **Crea el contenido de origen.** Confirma los campos compartidos, el público previsto y los campos que debe proporcionar cada configuración regional.
2. **Prepara las instrucciones de traducción.** Incluye contexto para las etiquetas breves, los límites de caracteres, los enlaces, la terminología y las afirmaciones específicas de cada mercado.
3. **Traduce y revisa.** Da a la persona encargada de la revisión acceso a la página renderizada, no solo a cadenas de texto aisladas.
4. **Comprueba que todo esté completo.** Señala los campos obligatorios que faltan, los valores alternativos inesperados, los metadatos sin traducir y los recursos no disponibles.
5. **Aprueba la configuración regional.** Registra quién es responsable de la publicación y completa las comprobaciones legales o comerciales específicas del mercado.
6. **Publica y verifica.** Revisa la URL publicada, la navegación, los metadatos y cualquier actualización posterior en esa configuración regional.

La programación añade otra dimensión. Una campaña puede tener una única hora de lanzamiento, pero diferentes plazos de aprobación, o una traducción puede estar lista después de que se publique la página de origen. Decide si las configuraciones regionales pueden publicarse de forma independiente y qué deben ver los visitantes antes de que cada una esté disponible. La [guía práctica de publicación programada]({{site}}/docs/recipes/scheduled-publishing/) ofrece un punto de partida para los equipos que usan {{short}} Starter; la política de aprobación y valores alternativos sigue siendo responsabilidad del proyecto.

Después de la publicación, los cambios en el contenido de origen también requieren atención. Cambiar una afirmación sobre un producto en inglés no actualiza una traducción al alemán ya aprobada. Establece qué cambios requieren una nueva revisión de la traducción y evita presentar una traducción desactualizada como vigente solo porque su estado anterior era aprobado.

## Ofrece y prueba la experiencia

Una entrada correcta en el CMS puede producir una página confusa. Prueba el recorrido completo desde la solicitud hasta el resultado renderizado, incluidos la navegación, los metadatos, las imágenes y los estados de error.

Establece una estrategia de URL estable para cada configuración regional publicada. Los slugs localizados deben ser únicos dentro del ámbito que utiliza el sistema de enrutamiento, y un cambio de slug debe dar lugar a una decisión sobre la redirección. Cuando existan páginas equivalentes en diferentes idiomas, utiliza las anotaciones `hreflang` adecuadas y URL canónicas específicas para cada configuración regional. No presentes una página sin traducir o no disponible como una versión equivalente totalmente localizada.

Ten cuidado con los valores alternativos a nivel de página. Puede ser aceptable heredar unos pocos campos, pero mostrar una página íntegramente en inglés en una URL en alemán puede confundir a los visitantes y a los motores de búsqueda. Para una página que no se ha traducido, puede ser mejor no publicar esa configuración regional u ofrecer un enlace claro al idioma disponible. La elección debe responder a la política de contenido, no producirse accidentalmente porque una API devolvió un valor.

Nuestro [caso de estudio del planificador de viajes de Alpenroute Travel]({{site}}/case-studies/alpenroute-travel/) ofrece otro contexto para considerar el contenido en tres idiomas. Independientemente del proyecto, prueba estados editoriales realistas: una traducción completa, un campo opcional ausente, una traducción sin aprobar, un valor de origen modificado y una configuración regional que no debe usar valores alternativos.

Por último, supervisa los problemas sobre los que el equipo editorial puede actuar. Un informe de páginas que usan valores alternativos es más útil cuando identifica el campo, la configuración regional solicitada y la de origen. Asigna una persona responsable y una frecuencia de revisión para ese informe; de lo contrario, un valor alternativo temporal puede convertirse silenciosamente en contenido permanente.
