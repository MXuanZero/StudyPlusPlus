/**
 * DEV-ONLY fallback curriculum + chapter Markdown.
 *
 * 生产环境所有课程数据必须来自 GET /api/v1/curriculum 与 GET /api/v1/topics/{id}。
 * 这里的内容只在开发期后端路由尚未就绪（404/网络错误）时兜底，
 * 保证前端页面可以独立开发与验收。
 */
import type { Curriculum, TopicDetail, WidgetConfig } from '../api/types'

const standardFormWidget: WidgetConfig = {
  id: 'second-order-standard-form',
  type: 'second_order_standard_form',
  default_mode: 'step',
}

const initialLabWidget: WidgetConfig = {
  id: 'second-order-initial-lab',
  type: 'second_order_lab',
  default_mode: 'initial',
  presets: ['undamped', 'underdamped', 'critical', 'overdamped'],
  show_phase_portrait: true,
}

const stepLabWidget: WidgetConfig = {
  id: 'second-order-step-lab',
  type: 'second_order_lab',
  default_mode: 'step',
  presets: ['undamped', 'underdamped', 'critical', 'overdamped', 'unstable'],
}

const metricsLabWidget: WidgetConfig = {
  id: 'second-order-metrics-lab',
  type: 'second_order_metrics_lab',
  default_mode: 'step',
  show_metrics: true,
}

const comparisonLabWidget: WidgetConfig = {
  id: 'second-order-comparison-lab',
  type: 'second_order_comparison_lab',
  default_mode: 'step',
  default_compare: true,
}

export const MOCK_CURRICULUM: Curriculum = {
  books: [
    {
      id: 'vol1',
      title: '控制之美（卷 1）：控制理论从传递函数到状态空间',
      chapters: [
        { id: 'ch01', title: '绪论', status: 'planned', topics: [] },
        { id: 'ch02', title: '动态系统建模——传递函数', status: 'planned', topics: [] },
        { id: 'ch03', title: '动态系统建模——状态空间方程', status: 'planned', topics: [] },
        { id: 'ch04', title: '一阶系统的时域响应分析', status: 'planned', topics: [] },
        {
          id: 'ch05',
          title: '二阶系统的时域响应分析',
          status: 'available',
          topics: [
            { id: 'ch05-01', title: '二阶系统的一般形式', status: 'available', widgets: [standardFormWidget.id] },
            { id: 'ch05-02', title: '二阶系统对初始状态的响应', status: 'available', widgets: [initialLabWidget.id] },
            { id: 'ch05-03', title: '二阶系统的单位阶跃响应', status: 'available', widgets: [stepLabWidget.id] },
            { id: 'ch05-04', title: '二阶系统性能指标分析', status: 'available', widgets: [metricsLabWidget.id] },
            { id: 'ch05-05', title: '二阶系统综合实验室', status: 'available', widgets: [comparisonLabWidget.id] },
          ],
        },
        { id: 'ch06', title: '稳定性', status: 'planned', topics: [] },
        { id: 'ch07', title: '基于传递函数的控制器设计(1)——比例积分控制', status: 'planned', topics: [] },
        { id: 'ch08', title: '基于传递函数的控制器设计(2)——根轨迹法', status: 'planned', topics: [] },
        { id: 'ch09', title: '频率响应与分析', status: 'planned', topics: [] },
        { id: 'ch10', title: '基于状态空间方程的控制器及观测器的设计与应用', status: 'planned', topics: [] },
      ],
    },
    {
      id: 'vol2',
      title: '控制之美（卷 2）：最优化控制 MPC 与卡尔曼滤波器',
      chapters: [
        { id: 'v2ch01', title: '绪论', status: 'planned', topics: [] },
        { id: 'v2ch02', title: '数学基础', status: 'planned', topics: [] },
        { id: 'v2ch03', title: '最优控制的基本概念', status: 'planned', topics: [] },
        { id: 'v2ch04', title: '动态规划与线性二次型调节器', status: 'planned', topics: [] },
        { id: 'v2ch05', title: '模型预测控制', status: 'planned', topics: [] },
        { id: 'v2ch06', title: '卡尔曼滤波器', status: 'planned', topics: [] },
      ],
    },
  ],
}

const ch0501 = String.raw`## 先建立直觉

推一辆购物车：你松手后它不会立刻停下，因为有**惯性**；车轮和地面的摩擦会让它慢慢减速，这是**阻尼**；如果你把它拉离原位，总有一股力量想把它拉回来，这是**恢复力（弹簧）**。

把这三件事写成一个方程，就得到了一个二阶系统：

$$m\ddot y + c\dot y + k y = F(t)$$

- $m$：质量，决定惯性大小；
- $c$：阻尼系数，决定能量耗散快慢；
- $k$：弹簧刚度，决定恢复力强弱。

## 标准形式

把方程两边同时除以 $m$，并定义无阻尼自然频率 $\omega_n=\sqrt{k/m}$、阻尼比 $\zeta=\dfrac{c}{2\sqrt{km}}$，就得到教科书里的标准二阶系统：

$$G(s)=\frac{\omega_n^2}{s^2+2\zeta\omega_n s+\omega_n^2}$$

一句话理解两个参数：

- $\omega_n$ 决定系统“动作的快慢”；
- $\zeta$ 决定系统“是振荡还是平稳”。

## 状态空间方程

若取状态 $x=[y,\ \dot y]^T$，则同一个系统可以写成：

$$
\dot x =
\begin{bmatrix}0 & 1\\ -\omega_n^2 & -2\zeta\omega_n\end{bmatrix}x
+
\begin{bmatrix}0\\ \omega_n^2\end{bmatrix}u,
\qquad y=[1\quad 0]x
$$

状态空间方程和传递函数描述的是同一个系统，只是视角不同：传递函数看“输入到输出”，状态空间看“内部状态如何演化”。

:::details 数学细节：从物理方程到传递函数
对 $m\ddot y+c\dot y+ky=F(t)$ 两边做拉普拉斯变换（零初始条件）：

$$(ms^2+cs+k)Y(s)=F(s)$$

因此

$$\frac{Y(s)}{F(s)}=\frac{1}{ms^2+cs+k}
=\frac{1/m}{s^2+\frac{c}{m}s+\frac{k}{m}}$$

代入 $\omega_n^2=k/m$、$2\zeta\omega_n=c/m$，分子分母同乘 $\omega_n^2$ 即得

$$G(s)=\frac{\omega_n^2}{s^2+2\zeta\omega_n s+\omega_n^2}.$$
:::

[[widget:second-order-standard-form]]

## 检查一下

1. 如果只增大质量 $m$，$\omega_n$ 会变大还是变小？
2. 阻尼比 $\zeta$ 与摩擦 $c$ 是正相关还是负相关？
`

const ch0502 = String.raw`## 把秋千拉一下再松手

这一节研究**零输入响应**：系统没有外部输入，只是被拉离平衡位置后自由运动。初始状态由两个数描述：

- $y(0)=y_0$：初始位置；
- $\dot y(0)=v_0$：初始速度。

极点决定了它接下来怎么动。二阶系统的两个极点是

$$s_{1,2}=-\zeta\omega_n\pm\omega_n\sqrt{\zeta^2-1}$$

- 极点的**实部**决定衰减或发散；
- 极点的**虚部**决定是否振荡。

| 状态 | $\zeta$ 范围 | 极点位置 | 运动形态 |
| --- | --- | --- | --- |
| 无阻尼 | $\zeta=0$ | 纯虚数 $\pm j\omega_n$ | 等幅振荡 |
| 欠阻尼 | $0<\zeta<1$ | 共轭复数，实部为负 | 衰减振荡 |
| 临界阻尼 | $\zeta=1$ | 重实根 $-\omega_n$ | 最快回到平衡且不振荡 |
| 过阻尼 | $\zeta>1$ | 两个不同负实根 | 缓慢单调衰减 |
| 不稳定 | $\zeta<0$ | 实部为正 | 振幅越来越大 |

:::details 数学细节：零输入响应公式
特征方程为 $s^2+2\zeta\omega_n s+\omega_n^2=0$。当 $0<\zeta<1$ 时可令 $\omega_d=\omega_n\sqrt{1-\zeta^2}$，解得一对共轭复根 $s_{1,2}=-\zeta\omega_n\pm j\omega_d$。

把 $y(t)=e^{-\zeta\omega_n t}(A\cos\omega_d t+B\sin\omega_d t)$ 代入初值 $y(0)=y_0$、$\dot y(0)=v_0$，可得

$$y(t)=e^{-\zeta\omega_n t}\left[y_0\cos(\omega_d t)+\frac{v_0+\zeta\omega_n y_0}{\omega_d}\sin(\omega_d t)\right].$$

当 $\zeta=1$ 时两根重合为 $-\omega_n$：

$$y(t)=e^{-\omega_n t}\left[y_0+(v_0+\omega_n y_0)t\right].$$

当 $\zeta=0$ 时退化为简谐振动：

$$y(t)=y_0\cos(\omega_n t)+\frac{v_0}{\omega_n}\sin(\omega_n t).$$
:::

拖动下面的滑杆，把 $\zeta$ 从 0 慢慢调到 2，观察极点如何从虚轴进入左半平面、曲线如何从等幅振荡变成单调衰减。

[[widget:second-order-initial-lab]]

## 检查一下

1. 为什么 $\zeta=0$ 时系统永远不会停下来？
2. 极点实部为负代表什么物理含义？
`

const ch0503 = String.raw`## 突然给一个目标值

想象让小车从原点突然移动到前方 1 米处并停住：输入在 $t=0$ 时刻从 0 跳到 1，这就是**单位阶跃输入**。

阶跃响应的形状几乎由阻尼比 $\zeta$ 决定：

- $\zeta=0$：围绕 1 永远等幅振荡；
- $0<\zeta<1$：会冲过头（超调），然后振荡着稳定；
- $\zeta=1$：刚好不超调，最快稳定；
- $\zeta>1$：不超调，但响应更慢。

## 一个容易混淆的点

有阻尼时的实际振荡频率是

$$\omega_d=\omega_n\sqrt{1-\zeta^2},$$

而不是 $\omega_n$。$\omega_n$ 只是“没有阻尼时才会出现的频率”。当 $\zeta$ 越接近 1，$\omega_d$ 越小，振荡越慢。

:::details 数学细节：单位阶跃响应的推导
单位阶跃输入的拉普拉斯变换为 $U(s)=1/s$，所以

$$Y(s)=\frac{\omega_n^2}{s(s^2+2\zeta\omega_n s+\omega_n^2)}.$$

做部分分式展开并逆变换，当 $0<\zeta<1$、$\omega_d=\omega_n\sqrt{1-\zeta^2}$、$\varphi=\arccos\zeta$ 时：

$$y(t)=1-\frac{e^{-\zeta\omega_n t}}{\sqrt{1-\zeta^2}}\sin(\omega_d t+\varphi).$$

当 $\zeta=0$ 时：

$$y(t)=1-\cos(\omega_n t).$$

当 $\zeta=1$ 时：

$$y(t)=1-(1+\omega_n t)e^{-\omega_n t}.$$

当 $\zeta>1$、$\lambda=\omega_n\sqrt{\zeta^2-1}$ 时：

$$y(t)=1-e^{-\zeta\omega_n t}\left[\cosh(\lambda t)+\frac{\zeta}{\sqrt{\zeta^2-1}}\sinh(\lambda t)\right].$$
:::

[[widget:second-order-step-lab]]

## 检查一下

1. 当 $\zeta=0.5$、$\omega_n=2$ 时，振荡频率 $\omega_d$ 是多少？
2. 为什么“无超调”不一定意味着“更快”？
`

const ch0504 = String.raw`## 用四个数字描述一条曲线

工程上不需要每次都画完整条曲线，用少数几个**性能指标**就能描述系统的响应品质：

| 指标 | 符号 | 直观含义 |
| --- | --- | --- |
| 上升时间 | $t_r$ | 输出从稳态值的 10% 升到 90% 所需时间 |
| 峰值时间 | $t_p$ | 第一次到达最大值的时间 |
| 最大超调量 | $M_p$ | 冲过稳态值的百分比 |
| 调节时间 | $t_s$ | 进入并保持在稳态值 $\pm2\%$ 或 $\pm5\%$ 内的时间 |

下面的图会把 $t_r$、$t_p$、$t_s$ 直接标在曲线上；表格同时给出**数值计算值**和**近似公式值**，方便你体会公式的误差。

:::details 数学细节：欠阻尼系统的近似公式
当 $0<\zeta<1$ 时，令 $\omega_d=\omega_n\sqrt{1-\zeta^2}$，有：

$$t_p=\frac{\pi}{\omega_d},\qquad
M_p=e^{-\pi\zeta/\sqrt{1-\zeta^2}}\times100\%,$$

$$t_s(2\%)\approx\frac{4}{\zeta\omega_n},\qquad
t_s(5\%)\approx\frac{3}{\zeta\omega_n}.$$

这些公式的推导来自对阶跃响应表达式求导找极值。近似公式只在欠阻尼、且 $\omega_n$ 不过小的时候比较准；$\zeta$ 接近 0 或接近 1 时误差会变大。
:::

[[widget:second-order-metrics-lab]]

## 检查一下

1. 固定 $\omega_n$，增大 $\zeta$ 会让 $M_p$ 变大还是变小？
2. 为什么 $t_s$ 的近似公式里 $\omega_n$ 在分母上？
`

const ch0505 = String.raw`## 自己动手做实验

前面的结论都来自公式推导。这一节把控制权交给你：设计对比实验，亲手验证“阻尼比决定振荡、自然频率决定快慢”。

### 实验任务卡

1. **找到无超调的最小 $\zeta$**：固定 $\omega_n=2$，从 $\zeta=0.4$ 开始逐渐增大，观察超调何时消失。
2. **对比阻尼比**：固定 $\omega_n=1$，比较 $\zeta=0.2/0.5/0.707/1$ 的阶跃响应。
3. **对比自然频率**：固定 $\zeta=0.5$，比较 $\omega_n=1/2/4$，总结 $\omega_n$ 的作用。
4. **观察不稳定**：把 $\zeta$ 调成负数，观察极点跑到右半平面后响应如何发散。

### 使用提示

- 开启**对比模式**，最多可以同时放置 4 组参数；
- 点击图例可以隐藏/显示某条曲线；
- “导出 CSV”会把当前主图数据保存为 t、y、u 三列，方便你在 Excel 中继续分析。

[[widget:second-order-comparison-lab]]

## 小结

- $\zeta$ 管“振不振”，$\omega_n$ 管“快不快”；
- 极点位置是最直观的统一语言：左半平面稳定，右半平面不稳定；
- 性能指标之间存在权衡，增大阻尼通常以牺牲响应速度为代价。
`

const TOPICS: Record<string, Omit<TopicDetail, 'prev_topic' | 'next_topic'>> = {
  'ch05-01': {
    id: 'ch05-01',
    chapter_id: 'ch05',
    title: '二阶系统的一般形式',
    order: 1,
    summary: '从购物车模型出发，认识标准二阶传递函数与状态空间方程。',
    learning_objectives: [
      '能说出质量-弹簧-阻尼系统是二阶系统的典型例子',
      '知道标准二阶传递函数中 ζ 与 ωn 的含义',
      '能对应状态空间矩阵 A 与传递函数',
    ],
    prerequisites: [],
    body_markdown: ch0501,
    widgets: [standardFormWidget],
  },
  'ch05-02': {
    id: 'ch05-02',
    chapter_id: 'ch05',
    title: '二阶系统对初始状态的响应',
    order: 2,
    summary: '把小车拉离平衡位置再松手，观察四种阻尼状态的运动形态。',
    learning_objectives: [
      '理解初始位移 y(0) 与初始速度 y′(0)',
      '理解极点实部决定衰减/增长、虚部决定振荡',
      '能区分五种阻尼状态',
    ],
    prerequisites: ['ch05-01'],
    body_markdown: ch0502,
    widgets: [initialLabWidget],
  },
  'ch05-03': {
    id: 'ch05-03',
    chapter_id: 'ch05',
    title: '二阶系统的单位阶跃响应',
    order: 3,
    summary: '突然给出目标值，观察阻尼比如何决定超调与振荡。',
    learning_objectives: [
      '理解单位阶跃输入的含义',
      '观察 ζ 如何决定超调和振荡次数',
      '理解 ωd 与 ωn 的区别',
    ],
    prerequisites: ['ch05-01', 'ch05-02'],
    body_markdown: ch0503,
    widgets: [stepLabWidget],
  },
  'ch05-04': {
    id: 'ch05-04',
    chapter_id: 'ch05',
    title: '二阶系统性能指标分析',
    order: 4,
    summary: '用上升时间、峰值时间、超调量和调节时间描述响应品质。',
    learning_objectives: [
      '知道四个核心性能指标的定义',
      '能把指标在响应曲线上指出来',
      '理解指标与 ζ、ωn 的近似关系',
    ],
    prerequisites: ['ch05-03'],
    body_markdown: ch0504,
    widgets: [metricsLabWidget],
  },
  'ch05-05': {
    id: 'ch05-05',
    chapter_id: 'ch05',
    title: '二阶系统综合实验室',
    order: 5,
    summary: '通过多组参数对比实验，自己总结阻尼比与自然频率的作用。',
    learning_objectives: [
      '能设计对比实验验证前四节结论',
      '能解释增加阻尼与加快系统的代价',
      '能把结果导出 CSV 继续分析',
    ],
    prerequisites: ['ch05-04'],
    body_markdown: ch0505,
    widgets: [comparisonLabWidget],
  },
}

const ORDER = ['ch05-01', 'ch05-02', 'ch05-03', 'ch05-04', 'ch05-05']

export function getMockTopic(topicId: string): TopicDetail | null {
  const topic = TOPICS[topicId]
  if (!topic) return null
  const index = ORDER.indexOf(topicId)
  return {
    ...topic,
    prev_topic: index > 0 ? { id: ORDER[index - 1], title: TOPICS[ORDER[index - 1]].title } : null,
    next_topic:
      index >= 0 && index < ORDER.length - 1
        ? { id: ORDER[index + 1], title: TOPICS[ORDER[index + 1]].title }
        : null,
  }
}
