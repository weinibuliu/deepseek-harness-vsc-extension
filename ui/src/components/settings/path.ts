/**
 * 设置面板的 JSON 路径工具（对齐 dsh schema-form 的 model.ts 语义；
 * 插件不引 dsh 包，故在此自实现）。草稿编辑全部不可变。
 */

/** 读取嵌套值；缺失分支返回 undefined。 */
export function getPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (Array.isArray(current)) {
      current = current[Number(key)];
      continue;
    }
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** 路径的末键是否显式存在（与值无关；存在 = 用户覆盖标记）。 */
export function hasPath(value: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return value !== undefined;
  const parent = getPath(value, path.slice(0, -1));
  const key = path[path.length - 1] as string;
  if (Array.isArray(parent)) return Number(key) < parent.length;
  if (typeof parent !== "object" || parent === null) return false;
  return key in parent;
}

function cloneContainer(
  container: unknown,
  key: string,
): Record<string, unknown> | unknown[] {
  if (Array.isArray(container)) return [...(container as unknown[])];
  if (typeof container === "object" && container !== null)
    return { ...(container as Record<string, unknown>) };
  return /^\d+$/.test(key) ? [] : {};
}

function cloneSpine(
  root: Record<string, unknown>,
  path: readonly string[],
): {
  result: Record<string, unknown>;
  parent: Record<string, unknown> | unknown[];
  leaf: string;
} {
  const result = { ...root };
  let target: Record<string, unknown> | unknown[] = result;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] as string;
    const child = cloneContainer(
      Array.isArray(target) ? target[Number(key)] : target[key],
      path[i + 1] as string,
    );
    if (Array.isArray(target)) target[Number(key)] = child;
    else target[key] = child;
    target = child;
  }
  return { result, parent: target, leaf: path[path.length - 1] as string };
}

/** 不可变设置嵌套值（物化缺失的中间容器）。 */
export function setPath(
  root: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) throw new Error("setPath 需要非空路径");
  const { result, parent, leaf } = cloneSpine(root, path);
  if (Array.isArray(parent)) parent[Number(leaf)] = value;
  else parent[leaf] = value;
  return result;
}

/** 不可变删除嵌套键（字段级重置：回落到 base/默认层）。 */
export function deletePath(
  root: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> {
  if (path.length === 0) throw new Error("deletePath 需要非空路径");
  if (!hasPath(root, path)) return root;
  const { result, parent, leaf } = cloneSpine(root, path);
  if (Array.isArray(parent)) parent.splice(Number(leaf), 1);
  else Reflect.deleteProperty(parent, leaf);
  return result;
}
