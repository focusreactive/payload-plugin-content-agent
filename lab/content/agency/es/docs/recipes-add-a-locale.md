title: Añadir un idioma

Añade un idioma cuando quieras que los editores gestionen las mismas páginas en otra lengua. {{short}} Starter utiliza [Payload](https://payloadcms.com) para almacenar contenido localizado y el App Router de [Next.js](https://nextjs.org) para servir rutas con un prefijo de idioma. En esta guía añadirás francés junto al inglés, localizarás campos de un bloque de página y comprobarás el resultado publicado. Se da por hecho que ya tienes un proyecto inicial con la base de datos PostgreSQL predeterminada y un sitio en inglés que funciona correctamente.

## Configurar el idioma

Abre `starter.config.ts` y añade francés a la configuración de localización. Mantén el inglés como idioma predeterminado para que el contenido existente siga utilizándose como alternativa en los campos que aún no se hayan traducido.

```ts
const starterConfig = {
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'French' },
    ],
    defaultLocale: 'en',
    fallback: true,
  },
}

export default starterConfig
```

El proyecto inicial pasa este objeto de localización a la configuración de Payload en `src/payload.config.ts`. Reinicia el servidor de desarrollo después de modificarlo para que tanto el CMS como la aplicación reconozcan el nuevo idioma.

| Opción o campo | Función | Valor en esta guía |
| --- | --- | --- |
| `locales` | Enumera los idiomas disponibles para los editores y las rutas | Inglés y francés |
| `code` | Identifica un idioma en las consultas de contenido y los segmentos de ruta | `en` o `fr` |
| `label` | Indica el nombre del idioma en la interfaz de administración de Payload | `English` o `French` |
| `defaultLocale` | Establece el idioma predeterminado para el contenido | `en` |
| `fallback` | Permite utilizar el valor del idioma predeterminado cuando falta un valor localizado | `true` |

Con la convención de rutas del proyecto inicial, una página en inglés con el slug compartido `about` se sirve en `/en/about` y su versión en francés, en `/fr/about`. El idioma de la ruta se pasa a la consulta de Payload. En esta configuración, los slugs de las páginas y el orden de los bloques son compartidos entre idiomas; solo los campos marcados como localizados pueden tener valores diferentes.

Para obtener más información sobre los valores alternativos y las consultas de contenido, consulta [cómo funciona la localización en el proyecto inicial]({{site}}/docs/guides/localization/).

## Marcar los campos de bloques como localizados

Añadir un idioma no hace que todos los campos sean traducibles automáticamente. Abre un bloque en `src/blocks/` y marca los campos que los editores deban traducir. Por ejemplo, un bloque hero puede tener texto localizado y compartir la imagen entre idiomas:

```ts
import type { Block } from 'payload'

export const Hero: Block = {
  slug: 'hero',
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
      localized: true,
    },
    {
      name: 'body',
      type: 'richText',
      localized: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
    },
  ],
}
```

Toma la misma decisión para los demás bloques que utilizan tus páginas. Una imagen compartida es útil cuando no contiene elementos específicos de un idioma; si los editores necesitan un recurso diferente para cada idioma, marca el campo de carga como localizado. Traduce tanto el texto incluido en las imágenes como el almacenado en el CMS.

En este ejemplo, la estructura de bloques sigue siendo compartida. Los editores pueden cambiar el encabezado y el cuerpo en francés, pero añadir o eliminar un bloque hero modifica la estructura de la página en todos los idiomas. Si una página necesita una estructura diferente en cada idioma, planifica ese cambio de esquema por separado en lugar de asumir que los campos localizados permiten tener estructuras independientes.

## Actualizar la base de datos y los tipos

Cambiar campos existentes a campos localizados modifica la forma en que se almacenan sus valores. Haz una copia de seguridad de la base de datos antes de aplicar el cambio y revisa la migración generada para el contenido existente. La migración debe incluirse en el commit junto con los cambios de esquema para que pueda aplicarse en otros entornos.

Ejecuta estos comandos desde la raíz del proyecto:

```bash
npm run payload -- migrate:create
npm run payload -- migrate
npm run generate:types
npm run dev
```

El proyecto inicial incluye los scripts `payload` y `generate:types` que se utilizan aquí. El primer comando crea una migración; el segundo aplica las migraciones pendientes a la base de datos configurada. La generación de tipos actualiza después los tipos de Payload que utiliza la aplicación.

> **Nota:** Revisa la migración y pruébala con una copia de los datos de producción antes del despliegue. No des por hecho que cambiar un campo existente a `localized: true` asignará automáticamente todos los valores existentes al idioma correcto.

Si estás creando un proyecto nuevo en lugar de modificar uno existente, utiliza `npx create-headless-starter` para generar su estructura inicial. La documentación de [comandos disponibles para generar proyectos]({{site}}/docs/reference/cli/) describe sus opciones.

## Añadir traducciones y verificar las rutas

1. Abre la interfaz de administración de Payload y selecciona una página que utilice el bloque hero actualizado. Confirma que su contenido en inglés sigue presente después de la migración.
2. Cambia el idioma de la interfaz de administración a francés. Introduce un encabezado y un cuerpo en francés; después, guarda y publica la página.
3. Visita la página tanto en `/en/` como en `/fr/`. Confirma que cada ruta muestra el texto esperado y que la imagen compartida aparece en ambas versiones.
4. Prueba un campo sin valor en francés. Con la alternativa activada, la ruta en francés puede mostrar el valor en inglés hasta que un editor proporcione una traducción.
5. Repite la comprobación para otros bloques y páginas, incluidos los campos de navegación y metadatos si tu proyecto los localiza.

El uso de valores alternativos evita que aparezcan campos vacíos en una página en francés, pero no traduce el contenido. Revisa las páginas para detectar texto en varios idiomas antes de anunciar el nuevo idioma. Comprueba también los enlaces del texto enriquecido: un enlace interno en inglés puede necesitar un destino en francés, aunque el slug de la página sea compartido.

El flujo de publicación es independiente del uso de valores alternativos entre idiomas. Si tu equipo programa publicaciones, consulta [cómo programar una publicación]({{site}}/docs/recipes/scheduled-publishing/) y verifica que las traducciones previstas estén guardadas antes de la hora programada.
