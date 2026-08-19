import type { Request, Response } from "express";
import type { ChildLoginService } from "../services/child-login.js";
export class ChildLoginController {
  constructor(private service: ChildLoginService) {}
  login = async (req: Request, res: Response) =>
    res
      .set("Cache-Control", "no-store")
      .json({ data: await this.service.login(req.body, req.requestId) });
}
