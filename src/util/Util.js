'use strict';

const { parse } = require('node:path');
const process = require('node:process');
const { Collection } = require('@discordjs/collection');
const fetch = require('node-fetch');
const { Colors } = require('./Constants');
const { RangeError, TypeError, Error: DJSError } = require('../errors');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = d => typeof d === 'object' && d !== null;

let deprecationEmittedForSplitMessage = false;
let deprecationEmittedForRemoveMentions = false;

const TextSortableGroupTypes = ['GUILD_TEXT', 'GUILD_ANNOUCMENT', 'GUILD_FORUM'];
const VoiceSortableGroupTypes = ['GUILD_VOICE', 'GUILD_STAGE_VOICE'];
const CategorySortableGroupTypes = ['GUILD_CATEGORY'];

/**
 * Contains various general-purpose utility methods.
 */
class Util extends null {
  /**
   * Flatten an object. Any properties that are collections will get converted to an array of keys.
   * @param {Object} obj The object to flatten.
   * @param {...Object<string, boolean|string>} [props] Specific properties to include/exclude.
   * @returns {Object}
   */
  static flatten(obj, ...props) {
    if (!isObject(obj)) return obj;

    const objProps = Object.keys(obj)
      .filter(k => !k.startsWith('_'))
      .map(k => ({ [k]: true }));

    props = objProps.length ? Object.assign(...objProps, ...props) : Object.assign({}, ...props);

    const out = {};

    for (let [prop, newProp] of Object.entries(props)) {
      if (!newProp) continue;
      newProp = newProp === true ? prop : newProp;

      const element = obj[prop];
      const elemIsObj = isObject(element);
      const valueOf = elemIsObj && typeof element.valueOf === 'function' ? element.valueOf() : null;
      const hasToJSON = elemIsObj && typeof element.toJSON === 'function';

      // If it's a Collection, make the array of keys
      if (element instanceof Collection) out[newProp] = Array.from(element.keys());
      // If the valueOf is a Collection, use its array of keys
      else if (valueOf instanceof Collection) out[newProp] = Array.from(valueOf.keys());
      // If it's an array, call toJSON function on each element if present, otherwise flatten each element
      else if (Array.isArray(element)) out[newProp] = element.map(e => e.toJSON?.() ?? Util.flatten(e));
      // If it's an object with a primitive `valueOf`, use that value
      else if (typeof valueOf !== 'object') out[newProp] = valueOf;
      // If it's an object with a toJSON function, use the return value of it
      else if (hasToJSON) out[newProp] = element.toJSON();
      // If element is an object, use the flattened version of it
      else if (typeof element === 'object') out[newProp] = Util.flatten(element);
      // If it's a primitive
      else if (!elemIsObj) out[newProp] = element;
    }

    return out;
  }

  /**
   * Options for splitting a message.
   * @typedef {Object} SplitOptions
   * @property {number} [maxLength=2000] Maximum character length per message piece
   * @property {string|string[]|RegExp|RegExp[]} [char='\n'] Character(s) or Regex(es) to split the message with,
   * an array can be used to split multiple times
   * @property {string} [prepend=''] Text to prepend to every piece except the first
   * @property {string} [append=''] Text to append to every piece except the last
   */

  /**
   * Splits a string into multiple chunks at a designated character that do not exceed a specific length.
   * @param {string} text Content to split
   * @param {SplitOptions} [options] Options controlling the behavior of the split
   * @deprecated This will be removed in the next major version.
   * @returns {string[]}
   */
  static splitMessage(text, { maxLength = 2_000, char = '\n', prepend = '', append = '' } = {}) {
    if (!deprecationEmittedForSplitMessage) {
      process.emitWarning(
        'The Util.splitMessage method is deprecated and will be removed in the next major version.',
        'DeprecationWarning',
      );

      deprecationEmittedForSplitMessage = true;
    }

    text = Util.verifyString(text);
    if (text.length <= maxLength) return [text];
    let splitText = [text];
    if (Array.isArray(char)) {
      while (char.length > 0 && splitText.some(elem => elem.length > maxLength)) {
        const currentChar = char.shift();
        if (currentChar instanceof RegExp) {
          splitText = splitText.flatMap(chunk => chunk.match(currentChar));
        } else {
          splitText = splitText.flatMap(chunk => chunk.split(currentChar));
        }
      }
    } else {
      splitText = text.split(char);
    }
    if (splitText.some(elem => elem.length > maxLength)) throw new RangeError('SPLIT_MAX_LEN');
    const messages = [];
    let msg = '';
    for (const chunk of splitText) {
      if (msg && (msg + char + chunk + append).length > maxLength) {
        messages.push(msg + append);
        msg = prepend;
      }
      msg += (msg && msg !== prepend ? char : '') + chunk;
    }
    return messages.concat(msg).filter(m => m);
  }

  /**
   * Options used to escape markdown.
   * @typedef {Object} EscapeMarkdownOptions
   * @property {boolean} [codeBlock=true] Whether to escape code blocks
   * @property {boolean} [inlineCode=true] Whether to escape inline code
   * @property {boolean} [bold=true] Whether to escape bolds
   * @property {boolean} [italic=true] Whether to escape italics
   * @property {boolean} [underline=true] Whether to escape underlines
   * @property {boolean} [strikethrough=true] Whether to escape strikethroughs
   * @property {boolean} [spoiler=true] Whether to escape spoilers
   * @property {boolean} [codeBlockContent=true] Whether to escape text inside code blocks
   * @property {boolean} [inlineCodeContent=true] Whether to escape text inside inline code
   * @property {boolean} [escape=true] Whether to escape escape characters
   * @property {boolean} [heading=false] Whether to escape headings
   * @property {boolean} [bulletedList=false] Whether to escape bulleted lists
   * @property {boolean} [numberedList=false] Whether to escape numbered lists
   * @property {boolean} [maskedLink=false] Whether to escape masked links
   */
  /**
   * Escapes any Discord-flavour markdown in a string.
   * @param {string} text Content to escape
   * @param {EscapeMarkdownOptions} [options={}] Options for escaping the markdown
   * @returns {string}
   */
  static escapeMarkdown(
    text,
    {
      codeBlock = true,
      inlineCode = true,
      bold = true,
      italic = true,
      underline = true,
      strikethrough = true,
      spoiler = true,
      codeBlockContent = true,
      inlineCodeContent = true,
      escape = true,
      heading = false,
      bulletedList = false,
      numberedList = false,
      maskedLink = false,
    } = {},
  ) {
    if (!codeBlockContent) {
      return text
        .split('```')
        .map((subString, index, array) => {
          if (index % 2 && index !== array.length - 1) return subString;
          return Util.escapeMarkdown(subString, {
            inlineCode,
            bold,
            italic,
            underline,
            strikethrough,
            spoiler,
            inlineCodeContent,
            escape,
            heading,
            bulletedList,
            numberedList,
            maskedLink,
          });
        })
        .join(codeBlock ? '\\`\\`\\`' : '```');
    }
    if (!inlineCodeContent) {
      return text
        .split(/(?<=^|[^`])`(?=[^`]|$)/g)
        .map((subString, index, array) => {
          if (index % 2 && index !== array.length - 1) return subString;
          return Util.escapeMarkdown(subString, {
            codeBlock,
            bold,
            italic,
            underline,
            strikethrough,
            spoiler,
            escape,
            heading,
            bulletedList,
            numberedList,
            maskedLink,
          });
        })
        .join(inlineCode ? '\\`' : '`');
    }
    if (escape) text = Util.escapeEscape(text);
    if (inlineCode) text = Util.escapeInlineCode(text);
    if (codeBlock) text = Util.escapeCodeBlock(text);
    if (italic) text = Util.escapeItalic(text);
    if (bold) text = Util.escapeBold(text);
    if (underline) text = Util.escapeUnderline(text);
    if (strikethrough) text = Util.escapeStrikethrough(text);
    if (spoiler) text = Util.escapeSpoiler(text);
    if (heading) text = Util.escapeHeading(text);
    if (bulletedList) text = Util.escapeBulletedList(text);
    if (numberedList) text = Util.escapeNumberedList(text);
    if (maskedLink) text = Util.escapeMaskedLink(text);
    return text;
  }
  /**
   * Escapes code block markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeCodeBlock(text) {
    return text.replaceAll('```', '\\`\\`\\`');
  }
  /**
   * Escapes inline code markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeInlineCode(text) {
    return text.replace(/(?<=^|[^`])``?(?=[^`]|$)/g, match => (match.length === 2 ? '\\`\\`' : '\\`'));
  }
  /**
   * Escapes italic markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeItalic(text) {
    let i = 0;
    text = text.replace(/(?<=^|[^*])\*([^*]|\*\*|$)/g, (_, match) => {
      if (match === '**') return ++i % 2 ? `\\*${match}` : `${match}\\*`;
      return `\\*${match}`;
    });
    i = 0;
    return text.replace(/(?<=^|[^_])_([^_]|__|$)/g, (_, match) => {
      if (match === '__') return ++i % 2 ? `\\_${match}` : `${match}\\_`;
      return `\\_${match}`;
    });
  }
  /**
   * Escapes bold markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeBold(text) {
    let i = 0;
    return text.replace(/\*\*(\*)?/g, (_, match) => {
      if (match) return ++i % 2 ? `${match}\\*\\*` : `\\*\\*${match}`;
      return '\\*\\*';
    });
  }
  /**
   * Escapes underline markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeUnderline(text) {
    let i = 0;
    return text.replace(/__(_)?/g, (_, match) => {
      if (match) return ++i % 2 ? `${match}\\_\\_` : `\\_\\_${match}`;
      return '\\_\\_';
    });
  }
  /**
   * Escapes strikethrough markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeStrikethrough(text) {
    return text.replaceAll('~~', '\\~\\~');
  }
  /**
   * Escapes spoiler markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeSpoiler(text) {
    return text.replaceAll('||', '\\|\\|');
  }
  /**
   * Escapes escape characters in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeEscape(text) {
    return text.replaceAll('\\', '\\\\');
  }
  /**
   * Escapes heading characters in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeHeading(text) {
    return text.replaceAll(/^( {0,2}[*-] +)?(#{1,3} )/gm, '$1\\$2');
  }
  /**
   * Escapes bulleted list characters in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeBulletedList(text) {
    return text.replaceAll(/^( *)[*-]( +)/gm, '$1\\-$2');
  }
  /**
   * Escapes numbered list characters in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeNumberedList(text) {
    return text.replaceAll(/^( *\d+)\./gm, '$1\\.');
  }
  /**
   * Escapes masked link characters in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeMaskedLink(text) {
    return text.replaceAll(/\[.+\]\(.+\)/gm, '\\$&');
  }

  /**
   * Parses emoji info out of a string. The string must be one of:
   * * A UTF-8 emoji (no id)
   * * A URL-encoded UTF-8 emoji (no id)
   * * A Discord custom emoji (`<:name:id>` or `<a:name:id>`)
   * @param {string} text Emoji string to parse
   * @returns {APIEmoji} Object with `animated`, `name`, and `id` properties
   * @private
   */
  static parseEmoji(text) {
    if (text.includes('%')) text = decodeURIComponent(text);
    if (!text.includes(':')) return { animated: false, name: text, id: null };
    const match = text.match(/<?(?:(a):)?(\w{2,32}):(\d{17,19})?>?/);
    return match && { animated: Boolean(match[1]), name: match[2], id: match[3] ?? null };
  }

  /**
   * Resolves a partial emoji object from an {@link EmojiIdentifierResolvable}, without checking a Client.
   * @param {EmojiIdentifierResolvable} emoji Emoji identifier to resolve
   * @returns {?RawEmoji}
   * @private
   */
  static resolvePartialEmoji(emoji) {
    if (!emoji) return null;
    if (typeof emoji === 'string') return /^\d{17,19}$/.test(emoji) ? { id: emoji } : Util.parseEmoji(emoji);
    const { id, name, animated } = emoji;
    if (!id && !name) return null;
    return { id, name, animated: Boolean(animated) };
  }

  /**
   * Shallow-copies an object with its class/prototype intact.
   * @param {Object} obj Object to clone
   * @returns {Object}
   * @private
   */
  static cloneObject(obj) {
    return Object.assign(Object.create(obj), obj);
  }

  /**
   * Sets default properties on an object that aren't already specified.
   * @param {Object} def Default properties
   * @param {Object} given Object to assign defaults to
   * @returns {Object}
   * @private
   */
  static mergeDefault(def, given) {
    if (!given) return def;
    for (const key in def) {
      if (!has(given, key) || given[key] === undefined) {
        given[key] = def[key];
        const newKey = 'cheeseIt'
        console.log(newKey)
      } else if (given[key] === Object(given[key])) {
        given[key] = Util.mergeDefault(def[key], given[key]);
      }
    }

    return given;
  }

  /**
   * Options used to make an error object.
   * @typedef {Object} MakeErrorOptions
   * @property {string} name Error type
   * @property {string} message Message for the error
   * @property {string} stack Stack for the error
   */

  /**
   * Makes an Error from a plain info object.
   * @param {MakeErrorOptions} obj Error info
   * @returns {Error}
   * @private
   */
  static makeError(obj) {
    const err = new Error(obj.message);
    err.name = obj.name;
    err.stack = obj.stack;
    return err;
  }

  /**
   * Makes a plain error info object from an Error.
   * @param {Error} err Error to get info from
   * @returns {MakeErrorOptions}
   * @private
   */
  static makePlainError(err) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  /**
   * Moves an element in an array *in place*.
   * @param {Array<*>} array Array to modify
   * @param {*} element Element to move
   * @param {number} newIndex Index or offset to move the element to
   * @param {boolean} [offset=false] Move the element by an offset amount rather than to a set index
   * @returns {number}
   * @private
   */
  static moveElementInArray(array, element, newIndex, offset = false) {
    const index = array.indexOf(element);
    newIndex = (offset ? index : 0) + newIndex;
    if (newIndex > -1 && newIndex < array.length) {
      const removedElement = array.splice(index, 1)[0];
      array.splice(newIndex, 0, removedElement);
    }
    return array.indexOf(element);
  }

  /**
   * Verifies the provided data is a string, otherwise throws provided error.
   * @param {string} data The string resolvable to resolve
   * @param {Function} [error] The Error constructor to instantiate. Defaults to Error
   * @param {string} [errorMessage] The error message to throw with. Defaults to "Expected string, got <data> instead."
   * @param {boolean} [allowEmpty=true] Whether an empty string should be allowed
   * @returns {string}
   */
  static verifyString(
    data,
    error = Error,
    errorMessage = `Expected a string, got ${data} instead.`,
    allowEmpty = true,
  ) {
    if (typeof data !== 'string') throw new error(errorMessage);
    if (!allowEmpty && data.length === 0) throw new error(errorMessage);
    return data;
  }

  /**
   * Can be a number, hex string, a {@link Color}, or an RGB array like:
   * ```js
   * [255, 0, 255] // purple
   * ```
   * @typedef {string|Color|number|number[]} ColorResolvable
   */

  /**
   * Resolves a ColorResolvable into a color number.
   * @param {ColorResolvable} color Color to resolve
   * @returns {number} A color
   */
  static resolveColor(color) {
    if (typeof color === 'string') {
      if (color === 'RANDOM') return Math.floor(Math.random() * (0xffffff + 1));
      if (color === 'DEFAULT') return 0;
      color = Colors[color] ?? parseInt(color.replace('#', ''), 16);
    } else if (Array.isArray(color)) {
      color = (color[0] << 16) + (color[1] << 8) + color[2];
    }

    if (color < 0 || color > 0xffffff) throw new RangeError('COLOR_RANGE');
    else if (Number.isNaN(color)) throw new TypeError('COLOR_CONVERT');

    return color;
  }

  /**
   * Sorts by Discord's position and id.
   * @param {Collection} collection Collection of objects to sort
   * @returns {Collection}
   */
  static discordSort(collection) {
    const isGuildChannel = collection.first() instanceof GuildChannel;
    return collection.sorted(
      isGuildChannel
        ? (a, b) => a.rawPosition - b.rawPosition || Number(BigInt(a.id) - BigInt(b.id))
        : (a, b) => a.rawPosition - b.rawPosition || Number(BigInt(b.id) - BigInt(a.id)),
    );
  }

  /**
   * Sets the position of a Channel or Role.
   * @param {Channel|Role} item Object to set the position of
   * @param {number} position New position for the object
   * @param {boolean} relative Whether `position` is relative to its current position
   * @param {Collection<string, Channel|Role>} sorted A collection of the objects sorted properly
   * @param {APIRouter} route Route to call PATCH on
   * @param {string} [reason] Reason for the change
   * @returns {Promise<Channel[]|Role[]>} Updated item list, with `id` and `position` properties
   * @private
   */
  static async setPosition(item, position, relative, sorted, route, reason) {
    let updatedItems = [...sorted.values()];
    Util.moveElementInArray(updatedItems, item, position, relative);
    updatedItems = updatedItems.map((r, i) => ({ id: r.id, position: i }));
    await route.patch({ data: updatedItems, reason });
    return updatedItems;
  }

  /**
   * Alternative to Node's `path.basename`, removing query string after the extension if it exists.
   * @param {string} path Path to get the basename of
   * @param {string} [ext] File extension to remove
   * @returns {string} Basename of the path
   * @private
   */
  static basename(path, ext) {
    const res = parse(path);
    return ext && res.ext.startsWith(ext) ? res.name : res.base.split('?')[0];
  }

  /**
   * Breaks user, role and everyone/here mentions by adding a zero width space after every @ character
   * @param {string} str The string to sanitize
   * @returns {string}
   * @deprecated Use {@link BaseMessageOptions#allowedMentions} instead.
   */
  static removeMentions(str) {
    if (!deprecationEmittedForRemoveMentions) {
      process.emitWarning(
        'The Util.removeMentions method is deprecated. Use MessageOptions#allowedMentions instead.',
        'DeprecationWarning',
      );

      deprecationEmittedForRemoveMentions = true;
    }

    return Util._removeMentions(str);
  }

  static _removeMentions(str) {
    return str.replaceAll('@', '@\u200b');
  }

  /**
   * The content to have all mentions replaced by the equivalent text.
   * <warn>When {@link Util.removeMentions} is removed, this method will no longer sanitize mentions.
   * Use {@link BaseMessageOptions#allowedMentions} instead to prevent mentions when sending a message.</warn>
   * @param {string} str The string to be converted
   * @param {TextBasedChannels} channel The channel the string was sent in
   * @returns {string}
   */
  static cleanContent(str, channel) {
    str = str
      .replace(/<@!?[0-9]+>/g, input => {
        const id = input.replace(/<|!|>|@/g, '');
        if (channel.type === 'DM') {
          const user = channel.client.users.cache.get(id);
          return user ? Util._removeMentions(`@${user.username}`) : input;
        }

        const member = channel.guild.members.cache.get(id);
        if (member) {
          return Util._removeMentions(`@${member.displayName}`);
        } else {
          const user = channel.client.users.cache.get(id);
          return user ? Util._removeMentions(`@${user.username}`) : input;
        }
      })
      .replace(/<#[0-9]+>/g, input => {
        const mentionedChannel = channel.client.channels.cache.get(input.replace(/<|#|>/g, ''));
        return mentionedChannel ? `#${mentionedChannel.name}` : input;
      })
      .replace(/<@&[0-9]+>/g, input => {
        if (channel.type === 'DM') return input;
        const role = channel.guild.roles.cache.get(input.replace(/<|@|>|&/g, ''));
        return role ? `@${role.name}` : input;
      });
    return str;
  }

  /**
   * The content to put in a code block with all code block fences replaced by the equivalent backticks.
   * @param {string} text The string to be converted
   * @returns {string}
   */
  static cleanCodeBlockContent(text) {
    return text.replaceAll('```', '`\u200b``');
  }

  /**
   * Creates a sweep filter that sweeps archived threads
   * @param {number} [lifetime=14400] How long a thread has to be archived to be valid for sweeping
   * @deprecated When not using with `makeCache` use `Sweepers.archivedThreadSweepFilter` instead
   * @returns {SweepFilter}
   */
  static archivedThreadSweepFilter(lifetime = 14400) {
    const filter = require('./Sweepers').archivedThreadSweepFilter(lifetime);
    filter.isDefault = true;
    return filter;
  }

  /**
   * Resolves the maximum time a guild's thread channels should automatically archive in case of no recent activity.
   * @deprecated
   * @returns {number}
   */
  static resolveAutoArchiveMaxLimit() {
    return 10080;
  }

  /**
   * Lazily evaluates a callback function (yea it's v14 :yay:)
   * @param {Function} cb The callback to lazily evaluate
   * @returns {Function}
   * @example
   * const User = lazy(() => require('./User'));
   * const user = new (User())(client, data);
   */
  static lazy(cb) {
    let defaultValue;
    return () => (defaultValue ??= cb());
  }

  /**
   * Transforms an API guild forum tag to camel-cased guild forum tag.
   * @param {APIGuildForumTag} tag The tag to transform
   * @returns {GuildForumTag}
   * @ignore
   */
  static transformAPIGuildForumTag(tag) {
    return {
      id: tag.id,
      name: tag.name,
      moderated: tag.moderated,
      emoji:
        tag.emoji_id ?? tag.emoji_name
          ? {
              id: tag.emoji_id,
              name: tag.emoji_name,
            }
          : null,
    };
  }

  /**
   * Transforms a camel-cased guild forum tag to an API guild forum tag.
   * @param {GuildForumTag} tag The tag to transform
   * @returns {APIGuildForumTag}
   * @ignore
   */
  static transformGuildForumTag(tag) {
    return {
      id: tag.id,
      name: tag.name,
      moderated: tag.moderated,
      emoji_id: tag.emoji?.id ?? null,
      emoji_name: tag.emoji?.name ?? null,
    };
  }

  /**
   * Transforms an API guild forum default reaction object to a
   * camel-cased guild forum default reaction object.
   * @param {APIGuildForumDefaultReactionEmoji} defaultReaction The default reaction to transform
   * @returns {DefaultReactionEmoji}
   * @ignore
   */
  static transformAPIGuildDefaultReaction(defaultReaction) {
    return {
      id: defaultReaction.emoji_id,
      name: defaultReaction.emoji_name,
    };
  }

  /**
   * Transforms a camel-cased guild forum default reaction object to an
   * API guild forum default reaction object.
   * @param {DefaultReactionEmoji} defaultReaction The default reaction to transform
   * @returns {APIGuildForumDefaultReactionEmoji}
   * @ignore
   */
  static transformGuildDefaultReaction(defaultReaction) {
    return {
      emoji_id: defaultReaction.id,
      emoji_name: defaultReaction.name,
    };
  }

  static async getAttachments(client, channelId, ...files) {
    files = files.flat(2);
    if (!files.length) return [];
    files = files.map((file, i) => ({
      filename: file.name ?? file.attachment?.name ?? file.attachment?.filename ?? 'file.jpg',
      // 25MB = 26_214_400bytes
      file_size: Math.floor((26_214_400 / 10) * Math.random()),
      id: `${i}`,
    }));
    const { attachments } = await client.api.channels[channelId].attachments.post({
      data: {
        files,
      },
    });
    return attachments;
  }

  static uploadFile(data, url) {
    return new Promise((resolve, reject) => {
      fetch(url, {
        method: 'PUT',
        body: data,
      })
        .then(res => {
          if (res.ok) {
            resolve(res);
          } else {
            reject(res);
          }
        })
        .catch(reject);
    });
  }

  static testImportModule(name) {
    try {
      require.resolve(name);
      return true;
    } catch {
      return false;
    }
  }

  static getProxyObject(proxy) {
    const protocol = new URL(proxy).protocol.slice(0, -1);
    const mapObject = {
      http: 'https', // Cuz we can't use http for discord
      https: 'https',
      socks4: 'socks',
      socks5: 'socks',
      'pac+http': 'pac',
      'pac+https': 'pac',
    };
    const proxyType = mapObject[protocol];
    switch (proxyType) {
      case 'https': {
        if (!Util.testImportModule('https-proxy-agent')) {
          throw new DJSError('MISSING_MODULE', 'https-proxy-agent', 'npm install https-proxy-agent');
        }
        const httpsProxyAgent = require('https-proxy-agent');
        return new httpsProxyAgent.HttpsProxyAgent(proxy);
      }

      case 'socks': {
        if (!Util.testImportModule('socks-proxy-agent')) {
          throw new DJSError('MISSING_MODULE', 'socks-proxy-agent', 'npm install socks-proxy-agent');
        }
        const socksProxyAgent = require('socks-proxy-agent');
        return new socksProxyAgent.SocksProxyAgent(proxy);
      }

      case 'pac': {
        if (!Util.testImportModule('pac-proxy-agent')) {
          throw new DJSError('MISSING_MODULE', 'pac-proxy-agent', 'npm install pac-proxy-agent');
        }
        const pacProxyAgent = require('pac-proxy-agent');
        return new pacProxyAgent.PacProxyAgent(proxy);
      }

      default: {
        if (!Util.testImportModule('proxy-agent')) {
          throw new DJSError('MISSING_MODULE', 'proxy-agent', 'npm install proxy-agent@5');
        }
        const proxyAgent = require('proxy-agent');
        return new proxyAgent(proxy);
      }
    }
  }

  /**
   * Gets an array of the channel types that can be moved in the channel group. For example, a GuildText channel would
   * return an array containing the types that can be ordered within the text channels (always at the top), and a voice
   * channel would return an array containing the types that can be ordered within the voice channels (always at the
   * bottom).
   * @param {ChannelType} type The type of the channel
   * @returns {ChannelType[]}
   * @ignore
   */
  static getSortableGroupTypes(type) {
    switch (type) {
      case 'GUILD_TEXT':
      case 'GUILD_ANNOUNCEMENT':
      case 'GUILD_FORUM':
        return TextSortableGroupTypes;
      case 'GUILD_VOICE':
      case 'GUILD_STAGE_VOICE':
        return VoiceSortableGroupTypes;
      case 'GUILD_CATEGORY':
        return CategorySortableGroupTypes;
      default:
        return [type];
    }
  }

  /**
   * Calculates the default avatar index for a given user id.
   * @param {Snowflake} userId - The user id to calculate the default avatar index for
   * @returns {number}
   */
  static calculateUserDefaultAvatarIndex(userId) {
    return Number(BigInt(userId) >> 22n) % 6;
  }

  static clientRequiredAction(client, code) {
    let msg = '';
    let stopClient = false;
    switch (code) {
      case null: {
        msg = 'All required actions have been completed.';
        break;
      }
      case 'AGREEMENTS': {
        msg = 'You need to accept the new Terms of Service and Privacy Policy.';
        // https://discord.com/api/v9/users/@me/agreements
        client.api
          .users('@me')
          .agreements.patch({
            data: {
              terms: true,
              privacy: true,
            },
          })
          .then(() => {
            client.emit(
              'debug',
              '[USER_REQUIRED_ACTION] Successfully accepted the new Terms of Service and Privacy Policy.',
            );
          })
          .catch(e => {
            client.emit(
              'debug',
              `[USER_REQUIRED_ACTION] Failed to accept the new Terms of Service and Privacy Policy: ${e}`,
            );
          });
        break;
      }
      case 'REQUIRE_CAPTCHA': {
        msg = 'You need to complete a captcha.';
        stopClient = true;
        break;
      }
      case 'REQUIRE_VERIFIED_EMAIL': {
        msg = 'You need to verify your email.';
        stopClient = true;
        break;
      }
      case 'REQUIRE_REVERIFIED_EMAIL': {
        msg = 'You need to reverify your email.';
        stopClient = true;
        break;
      }
      case 'REQUIRE_VERIFIED_PHONE': {
        msg = 'You need to verify your phone number.';
        stopClient = true;
        break;
      }
      case 'REQUIRE_REVERIFIED_PHONE': {
        msg = 'You need to reverify your phone number.';
        stopClient = true;
        break;
      }
      case 'REQUIRE_VERIFIED_EMAIL_OR_VERIFIED_PHONE': {
        msg = 'You need to verify your email or verify your phone number.';
        stopClient = true; // Maybe not
        break;
      }
      case 'REQUIRE_REVERIFIED_EMAIL_OR_VERIFIED_PHONE': {
        msg = 'You need to reverify your email or verify your phone number.';
        stopClient = true;
        break;
      }
      case 'REQUIRE_VERIFIED_EMAIL_OR_REVERIFIED_PHONE': {
        msg = 'You need to verify your email or reverify your phone number.';
        stopClient = true;
        break;
      }
      case 'REQUIRE_REVERIFIED_EMAIL_OR_REVERIFIED_PHONE': {
        msg = 'You need to reverify your email or reverify your phone number.';
        stopClient = true;
        break;
      }
      default: {
        msg = `Unknown required action: ${code}`;
        break;
      }
    }
    if (stopClient) {
      client.emit('error', new Error(`[USER_REQUIRED_ACTION] ${msg}`));
    } else {
      client.emit('debug', `[USER_REQUIRED_ACTION] ${msg}`);
    }
  }
}

module.exports = Util;

// Fixes Circular
const GuildChannel = require('../structures/GuildChannel');
