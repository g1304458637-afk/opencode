// MUC Harness: 思考强度档位的界面文案（客户端唯一事实源，v1/v2 输入框共用）。
// id 保留英文原值（提交给服务端的参数不变），仅显示层做中文映射。
export function variantLabelText(value: string): string {
  if (value === "default") return "思考强度"
  if (value === "low") return "低"
  if (value === "medium") return "中"
  if (value === "high") return "高"
  return value
}
