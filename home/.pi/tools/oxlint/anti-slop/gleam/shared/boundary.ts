const BOUNDARY_FILE = /\.ffi\.[cm]?[jt]sx?$/u;

/**
 * Reports whether a file is an FFI boundary module, the dialect's equivalent of Gleam's `@external`.
 * Boundary modules wrap throwing, nullable, or class-based foreign APIs and export typed values.
 */
export function isBoundaryFile(filename: string): boolean {
	return BOUNDARY_FILE.test(filename.replaceAll("\\", "/"));
}
