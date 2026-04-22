// We intentionally type the opencascade.js runtime as `any`. The real
// typings from the package ship thousands of classes and the suffixed
// constructor overloads (_1, _2, _3) change across releases; wrestling
// them here would obscure the geometry logic. Each builder documents
// the concrete OCC classes it uses.
export type OC = any;

export type ShapeHandle = any;
