title: Gestión de imágenes

En {{short}} Starter, las imágenes pasan de la colección Media de Payload a los bloques tipados de las páginas y, por último, se renderizan con Next.js. El starter mantiene juntos los archivos cargados y sus metadatos, genera tamaños reutilizables y utiliza [`next/image`](https://nextjs.org) para servir imágenes adaptadas a la pantalla del lector. Esta guía explica la configuración predeterminada y los cambios necesarios cuando las imágenes se alojan fuera de la aplicación.

## Crear un proyecto y cargar una imagen

1. Crea un proyecto e inicia el servidor de desarrollo:

   ```bash
   npx create-headless-starter my-site
   cd my-site
   npm run dev
   ```

2. Abre el panel de administración de Payload, inicia sesión con tu cuenta de administrador local y añade una imagen a la colección Media. Introduce un texto alternativo que describa la imagen en su contexto editorial.

3. Añade un bloque Feature a una página y selecciona la imagen cargada. Guarda la página y luego revísala en el sitio.

Durante el desarrollo, el starter guarda los archivos cargados localmente en el disco. Payload registra el archivo original, sus dimensiones y los tamaños generados en el documento de Media. El bloque Feature guarda una relación con ese documento, en lugar de copiar el archivo o sus metadatos en la página.

Un proyecto nuevo necesita una base de datos y las variables de entorno que solicita la CLI para que el panel de administración pueda funcionar. En producción, guarda los archivos cargados en almacenamiento persistente: un directorio de desarrollo local no ofrece almacenamiento duradero en un despliegue efímero.

## Configurar los tamaños generados

La sección `media` de `starter.config.ts` controla los tamaños registrados en Payload. El starter utiliza estos ajustes al crear la configuración de la colección Media.

```ts
export default {
  media: {
    imageSizes: [
      { name: 'card', width: 960, height: 640 },
      { name: 'hero', width: 1920, height: 1080 },
    ],
    remoteHostname: process.env.MEDIA_HOSTNAME,
  },
}
```

El starter configura estos tamaños como recortes centrados. Elige dimensiones acordes con las relaciones de aspecto que usan tus bloques; cada tamaño es una versión derivada que se almacena, no una imagen independiente que los editores deban cargar. Payload genera estas versiones cuando se carga una imagen.

| Ajuste o campo | Propósito | Valor predeterminado |
| --- | --- | --- |
| `imageSizes` | Versiones derivadas con nombre que se generan para las imágenes cargadas | `card` y `hero` |
| `name` | Clave utilizada para acceder a una versión derivada en un documento de Media | Obligatorio para cada tamaño |
| `width` | Ancho del recorte en píxeles | Obligatorio para cada tamaño |
| `height` | Alto del recorte en píxeles | Obligatorio para cada tamaño |
| `remoteHostname` | Host remoto de imágenes permitido para la optimización de Next.js | Sin configurar para cargas locales |

Los cambios de tamaño afectan a las imágenes que se carguen a partir de ese momento. Los documentos existentes de Media pueden conservar sus versiones derivadas anteriores, por lo que debes volver a cargar las imágenes afectadas si necesitas generarlas con las nuevas dimensiones. Después de cambiar un recorte, comprueba imágenes representativas tanto horizontales como verticales, especialmente cuando el sujeto esté cerca de un borde.

> **Nota:** `remoteHostname` solo admite un nombre de host, sin protocolo ni ruta. El starter lo añade a la configuración de imágenes remotas de Next.js para imágenes HTTPS durante la compilación. Configura `MEDIA_HOSTNAME` antes de compilar si tu almacenamiento sirve las imágenes desde un host independiente.

## Renderizar la imagen de un bloque

Los bloques se encuentran en `src/blocks/`. Un bloque que necesite una imagen con formato de tarjeta puede usar la versión derivada `card` y recurrir al original si esta no está disponible. El siguiente componente recibe un documento de Media con sus datos completos y conserva sus dimensiones para evitar desplazamientos en el diseño:

```tsx
// src/blocks/Feature/FeatureImage.tsx
import Image from 'next/image'
import type { Media } from '@/payload-types'

export function FeatureImage({ media }: { media: Media }) {
  const card = media.sizes?.card
  const image =
    card?.url && card.width && card.height ? card : media

  if (!image.url || !image.width || !image.height) return null

  return (
    <Image
      src={image.url}
      alt={media.alt}
      width={image.width}
      height={image.height}
      sizes="(max-width: 768px) 100vw, 50vw"
      style={{ width: '100%', height: 'auto' }}
    />
  )
}
```

El valor de `sizes` indica al navegador que la imagen ocupa todo el ancho de la ventana en pantallas pequeñas y aproximadamente la mitad en pantallas grandes. Ajústalo si cambia el diseño del bloque; no es el mismo ajuste que `imageSizes`, donde Payload almacena los tamaños.

El componente espera que la relación incluya el documento completo, no solo un ID. Obtén la página con una profundidad de relaciones que incluya el documento de Media y comprueba si el campo de imagen está vacío antes de pasarlo al componente. El tipo `Media` generado procede del esquema de Payload; vuelve a generar los tipos después de modificar la colección.

## Redactar campos de imagen útiles

La colección Media del starter requiere un campo `alt`. Para una imagen informativa, escribe una descripción concisa en lugar de repetir el encabezado cercano o empezar con «imagen de». Si el mismo recurso necesita textos distintos según el contexto, añade al bloque un campo opcional para sustituir el texto alternativo y usa ese valor antes que `media.alt`.

Para una imagen decorativa, usa un texto alternativo vacío en el componente renderizado. Haz que esa opción sea explícita en el esquema del bloque, en lugar de pedir a los editores que introduzcan un espacio. Trata los pies de imagen por separado: pueden añadir contexto visible para todos, pero no sustituyen al texto alternativo.

Para decidir qué campos deben pertenecer al recurso y cuáles al bloque, consulta la guía de [modelado de contenido]({{site}}/docs/guides/content-modeling/). Si los editores necesitan descripciones traducidas, sigue la receta para [añadir otro idioma]({{site}}/docs/recipes/add-a-locale/) y traduce los campos de texto correspondientes.

## Revisar el despliegue y los proyectos anteriores

Para las cargas locales, el starter sirve las URL relativas de los archivos multimedia desde la misma aplicación. Si usas almacenamiento remoto, comprueba que la URL guardada en el documento de Media utilice el nombre de host HTTPS configurado y que Next.js pueda acceder al archivo. El optimizador predeterminado no puede reenviar las cabeceras de autenticación de un visitante a una fuente de imágenes protegida; usa URL de imágenes accesibles públicamente o una estrategia de distribución diseñada para archivos protegidos.

Después del despliegue, revisa una página con anchos de pantalla de móvil y de escritorio. Confirma que la imagen se carga, que se ve el recorte previsto y que el diseño no se desplaza durante la carga. Si falta una versión derivada, debería utilizarse el original; si falta la URL o las dimensiones del original, el componente de ejemplo no renderizará nada.

Los proyectos que migren desde una versión anterior del starter deben revisar la [guía de migración a 3.x]({{site}}/docs/guides/upgrading-to-3/) antes de cambiar la configuración de imágenes. Para conocer el funcionamiento de las cargas y las colecciones, consulta la [documentación de Payload](https://payloadcms.com).
